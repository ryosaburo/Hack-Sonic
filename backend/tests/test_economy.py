import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import engine
from app.economy import PRODUCTS, SHOP, rarity_multipliers
from app.main import app
from app.models import CatalogEntry, CastAttempt, Collection, User, Wallet
from app.routers import cast


@pytest.fixture
def game(monkeypatch):
    with TestClient(app) as client:
        headers = {"X-Device-Id": str(uuid4())}
        client.get('/api/economy', headers=headers)
        with Session(engine) as session:
            user = session.exec(select(User).where(User.device_id == headers['X-Device-Id'])).one()
            entry = session.exec(select(CatalogEntry).where(CatalogEntry.rarity == 'common')).first()
            entry.point = 17
            session.commit()
            user_id, species_id = user.id, entry.id
        monkeypatch.setattr(cast, '_draw_rarity', lambda available, multipliers=None: 'common')
        monkeypatch.setattr(cast, '_draw_entry', lambda session, rarity, season, x=0, y=0: session.get(CatalogEntry, species_id))
        yield client, headers, user_id, species_id


def fund(user_id, amount=1000, inventory=None):
    with Session(engine) as session:
        wallet = session.get(Wallet, user_id) or Wallet(user_id=user_id)
        wallet.balance = amount
        wallet.inventory = inventory or {}
        session.add(wallet)
        session.commit()


def start(client, headers, **params):
    response = client.post('/api/cast/start', headers=headers, json={"request_id": str(uuid4()), **params})
    assert response.status_code == 200, response.text
    return response.json()


def resolve(client, headers, attempt, success=True):
    response = client.post('/api/cast/resolve', headers=headers, json={"attempt_id": attempt['attempt_id'], "success": success})
    assert response.status_code == 200, response.text
    return response.json()


def test_new_release_stays_unknown_then_known_rewards_once(game):
    client, headers, user_id, species_id = game
    attempt = start(client, headers)
    assert resolve(client, headers, attempt)['earned_points'] == 0
    decision = {"attempt_id": attempt['attempt_id'], "decision": 'release'}
    assert client.post('/api/cast/decision', headers=headers, json=decision).status_code == 200
    assert client.get('/api/collection', headers=headers).json() == []
    attempt = start(client, headers)
    assert resolve(client, headers, attempt)['is_new_species']
    decision = {"attempt_id": attempt['attempt_id'], "decision": 'keep'}
    for _ in range(2):
        assert client.post('/api/cast/decision', headers=headers, json=decision).status_code == 200
    assert client.post('/api/cast/decision', headers=headers, json={**decision, 'decision': 'release'}).status_code == 409
    attempt = start(client, headers)
    result = resolve(client, headers, attempt)
    assert result['earned_points'] == 17
    assert result['catch_count'] == 2
    assert not result['is_new_species']
    assert resolve(client, headers, attempt) == result
    with Session(engine) as session:
        assert session.get(Wallet, user_id).balance == 17
        assert session.exec(select(Collection).where(Collection.user_id == user_id, Collection.species_id == species_id)).one().catch_count == 2
    failed = resolve(client, headers, start(client, headers), False)
    assert failed['earned_points'] == 0
    assert failed['economy']['balance'] == 17


def test_exchange_idempotency_permanent_and_insufficient(game):
    client, headers, user_id, _ = game
    fund(user_id, 120)
    body = {'request_id': str(uuid4()), 'product_id': 'time_extension'}
    for _ in range(2):
        response = client.post('/api/economy/exchange', headers=headers, json=body)
        assert response.status_code == 200
        assert response.json()['balance'] == 0
        assert response.json()['inventory']['time_extension'] == 1
        assert response.json()['equipped']['time_extension'] is False
    assert client.post('/api/economy/exchange', headers=headers, json={**body, 'product_id': 'lure'}).status_code == 409
    for product in ['time_extension', 'lure']:
        assert client.post('/api/economy/exchange', headers=headers, json={'request_id': str(uuid4()), 'product_id': product}).status_code == 409
    assert client.post('/api/economy/exchange', headers=headers, json={'request_id': str(uuid4()), 'product_id': 'missing'}).status_code == 404


def test_parallel_exchanges_cannot_overdraw(game):
    client, headers, user_id, _ = game
    fund(user_id, 100)
    def buy(_):
        return client.post('/api/economy/exchange', headers=headers, json={'request_id': str(uuid4()), 'product_id': 'lure'}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(buy, range(2))) == [200, 409]
    assert client.get('/api/economy', headers=headers).json()['inventory']['lure'] == 1


def test_cast_consumption_replay_gear_and_foreign_attempt(game):
    client, headers, user_id, _ = game
    fund(user_id, inventory={'lure': 1, 'time_extension': 1, 'power_reel': 1})
    body = {'request_id': str(uuid4()), 'use_lure': True}
    result = start(client, headers, **body)
    assert result['time_limit'] == 20
    assert result['damage_multiplier'] == 1
    assert result['economy']['inventory']['lure'] == 0
    assert start(client, headers, **body) == result
    for product in ('time_extension', 'power_reel'):
        equipped = client.put('/api/economy/equipment', headers=headers, json={'product_id': product, 'equipped': True})
        assert equipped.status_code == 200
        assert equipped.json()['equipped'][product] is True
    # 装備を変更しても開始済みの試行にはさかのぼって適用しない。
    assert start(client, headers, **body) == result
    geared = start(client, headers)
    assert geared['time_limit'] == 25
    assert geared['damage_multiplier'] == 1.25
    assert client.post('/api/cast/start', headers=headers, json={'use_lure': True}).status_code == 409
    assert client.post('/api/cast/start', headers=headers, json={**body, 'use_lure': False}).status_code == 409
    other = {'X-Device-Id': str(uuid4())}
    assert client.post('/api/cast/resolve', headers=other, json={'attempt_id': result['attempt_id'], 'success': True}).status_code == 404
    failed = resolve(client, headers, result, False)
    assert failed['economy']['inventory']['lure'] == 0
    assert failed['economy']['inventory']['time_extension'] == 1
    assert start(client, headers)['damage_multiplier'] == 1.25


def test_equipment_requires_ownership_and_persists_toggle(game):
    client, headers, user_id, _ = game
    assert client.put('/api/economy/equipment', headers=headers, json={'product_id': 'time_extension', 'equipped': True}).status_code == 409
    assert client.put('/api/economy/equipment', headers=headers, json={'product_id': 'lure', 'equipped': True}).status_code == 422
    fund(user_id, inventory={'time_extension': 1, 'power_reel': 1})
    assert start(client, headers)['time_limit'] == 20
    assert start(client, headers)['damage_multiplier'] == 1

    clock = {'product_id': 'time_extension', 'equipped': True}
    for _ in range(2):
        response = client.put('/api/economy/equipment', headers=headers, json=clock)
        assert response.status_code == 200
        assert response.json()['equipped'] == {'time_extension': True, 'power_reel': False}
    assert start(client, headers)['time_limit'] == 25
    assert start(client, headers)['damage_multiplier'] == 1

    client.put('/api/economy/equipment', headers=headers, json={'product_id': 'power_reel', 'equipped': True})
    assert start(client, headers)['damage_multiplier'] == 1.25
    clock['equipped'] = False
    client.put('/api/economy/equipment', headers=headers, json=clock)
    assert start(client, headers)['time_limit'] == 20
    assert start(client, headers)['damage_multiplier'] == 1.25
    with Session(engine) as session:
        assert session.get(Wallet, user_id).equipped == {'time_extension': False, 'power_reel': True}


def test_expired_attempt_and_invalid_coordinates(game):
    client, headers, _, _ = game
    attempt = start(client, headers)
    with Session(engine) as session:
        row = session.get(CastAttempt, attempt['attempt_id'])
        row.created_at = time.time() - 301
        session.commit()
    assert client.post('/api/cast/resolve', headers=headers, json={'attempt_id': attempt['attempt_id'], 'success': True}).status_code == 410
    assert client.post('/api/cast/start', headers=headers, json={'x': 1000001}).status_code == 422


def test_information_disclosure_and_boundaries(game):
    client, headers, user_id, _ = game
    fund(user_id, 150)
    assert client.get('/api/economy', headers=headers).json()['spots'] == []
    assert 'x_min' not in client.get('/api/economy/products').text
    body = {'request_id': str(uuid4()), 'product_id': 'silver_current'}
    result = client.post('/api/economy/exchange', headers=headers, json=body).json()
    assert result['balance'] == 0
    assert result['spots'][0]['x_min'] == 700
    assert rarity_multipliers(700, -200, False) == [1, 1.3, 1.6, 2]
    assert rarity_multipliers(1300, 200, True) == pytest.approx([1, 1.95, 3.2, 6])
    assert rarity_multipliers(699, 0, False) == [1, 1, 1, 1]


def test_draw_weights_and_mock_config_match(monkeypatch):
    observed = {}
    def choices(values, weights, k):
        observed.update(values=values, weights=weights)
        return [values[0]]
    monkeypatch.setattr(cast.random, 'choices', choices)
    cast._draw_rarity({'rare', 'legendary'}, [1, 1.5, 2, 3])
    assert observed == {'values': ['rare', 'legendary'], 'weights': [30, 6]}
    path = Path(__file__).resolve().parents[2] / 'frontend/src/data/shop.mock.json'
    assert json.loads(path.read_text()) == SHOP
    assert PRODUCTS['time_extension']['kind'] == 'permanent'


def test_parallel_resolve_has_one_reward_and_persists(game):
    client, headers, user_id, species_id = game
    with Session(engine) as session:
        session.add(Collection(user_id=user_id, species_id=species_id))
        session.commit()
    attempt = start(client, headers)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: resolve(client, headers, attempt), range(2)))
    assert results[0] == results[1]
    # 新しいセッションでも同じ確定結果を読み出せる（プロセスメモリには依存しない）。
    with Session(engine) as session:
        assert session.get(CastAttempt, attempt['attempt_id']).result == results[0]
        assert session.get(Wallet, user_id).balance == 17


def test_test_points_granted_once_to_existing_player(game, monkeypatch):
    client, headers, user_id, _ = game
    fund(user_id, 37)
    monkeypatch.setenv('SPACE_FISHING_TEST_POINTS', '500')

    def opening(_):
        response = client.get('/api/economy', headers=headers)
        assert response.status_code == 200
        return response.json()['balance']

    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(opening, range(3))) == [537, 537, 537]

    purchase = client.post('/api/economy/exchange', headers=headers, json={
        'request_id': str(uuid4()), 'product_id': 'lure',
    })
    assert purchase.status_code == 200
    assert purchase.json()['balance'] == 437
    assert opening(None) == 437

    # 設定を切って再度有効にしても、同じプレイヤーには再付与しない。
    monkeypatch.delenv('SPACE_FISHING_TEST_POINTS')
    assert opening(None) == 437
    monkeypatch.setenv('SPACE_FISHING_TEST_POINTS', '500')
    assert opening(None) == 437
    with Session(engine) as session:
        assert session.get(Wallet, user_id).test_grant_applied is True

    other = {'X-Device-Id': str(uuid4())}
    assert client.get('/api/economy', headers=other).json()['balance'] == 500
