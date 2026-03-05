"""
Seed the database with sample Pokemon card data and simulated price history.
Used when the Pokemon TCG API is unavailable.
"""
import json
import random
import math
from datetime import date, timedelta, datetime, timezone
from sqlalchemy.orm import Session
from server.models.card import Card
from server.models.price_history import PriceHistory

SAMPLE_CARDS = [
    {"tcg_id": "sv1-1", "name": "Sprigatito", "set_name": "Scarlet & Violet", "set_id": "sv1", "number": "1", "rarity": "Common", "supertype": "Pokemon", "subtypes": ["Basic"], "hp": "70", "types": ["Grass"], "image_small": "https://images.pokemontcg.io/sv1/1.png", "image_large": "https://images.pokemontcg.io/sv1/1_hires.png", "base_price": 0.25},
    {"tcg_id": "sv1-198", "name": "Miraidon ex", "set_name": "Scarlet & Violet", "set_id": "sv1", "number": "198", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "220", "types": ["Electric"], "image_small": "https://images.pokemontcg.io/sv1/198.png", "image_large": "https://images.pokemontcg.io/sv1/198_hires.png", "base_price": 28.50},
    {"tcg_id": "sv1-197", "name": "Koraidon ex", "set_name": "Scarlet & Violet", "set_id": "sv1", "number": "197", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "230", "types": ["Fighting"], "image_small": "https://images.pokemontcg.io/sv1/197.png", "image_large": "https://images.pokemontcg.io/sv1/197_hires.png", "base_price": 22.00},
    {"tcg_id": "base1-4", "name": "Charizard", "set_name": "Base Set", "set_id": "base1", "number": "4", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Stage 2"], "hp": "120", "types": ["Fire"], "image_small": "https://images.pokemontcg.io/base1/4.png", "image_large": "https://images.pokemontcg.io/base1/4_hires.png", "base_price": 350.00},
    {"tcg_id": "base1-2", "name": "Blastoise", "set_name": "Base Set", "set_id": "base1", "number": "2", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Stage 2"], "hp": "100", "types": ["Water"], "image_small": "https://images.pokemontcg.io/base1/2.png", "image_large": "https://images.pokemontcg.io/base1/2_hires.png", "base_price": 85.00},
    {"tcg_id": "base1-15", "name": "Venusaur", "set_name": "Base Set", "set_id": "base1", "number": "15", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Stage 2"], "hp": "100", "types": ["Grass"], "image_small": "https://images.pokemontcg.io/base1/15.png", "image_large": "https://images.pokemontcg.io/base1/15_hires.png", "base_price": 65.00},
    {"tcg_id": "swsh9-166", "name": "Arceus VSTAR", "set_name": "Brilliant Stars", "set_id": "swsh9", "number": "166", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["VSTAR"], "hp": "280", "types": ["Colorless"], "image_small": "https://images.pokemontcg.io/swsh9/166.png", "image_large": "https://images.pokemontcg.io/swsh9/166_hires.png", "base_price": 18.00},
    {"tcg_id": "sv3pt5-207", "name": "Charizard ex", "set_name": "151", "set_id": "sv3pt5", "number": "207", "rarity": "Special Art Rare", "supertype": "Pokemon", "subtypes": ["Stage 2", "ex"], "hp": "330", "types": ["Fire"], "image_small": "https://images.pokemontcg.io/sv3pt5/207.png", "image_large": "https://images.pokemontcg.io/sv3pt5/207_hires.png", "base_price": 155.00},
    {"tcg_id": "swsh12pt5-160", "name": "Lugia VSTAR", "set_name": "Crown Zenith", "set_id": "swsh12pt5", "number": "160", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["VSTAR"], "hp": "270", "types": ["Colorless"], "image_small": "https://images.pokemontcg.io/swsh12pt5/160.png", "image_large": "https://images.pokemontcg.io/swsh12pt5/160_hires.png", "base_price": 12.00},
    {"tcg_id": "base1-58", "name": "Pikachu", "set_name": "Base Set", "set_id": "base1", "number": "58", "rarity": "Common", "supertype": "Pokemon", "subtypes": ["Basic"], "hp": "40", "types": ["Electric"], "image_small": "https://images.pokemontcg.io/base1/58.png", "image_large": "https://images.pokemontcg.io/base1/58_hires.png", "base_price": 15.00},
    {"tcg_id": "sv2-234", "name": "Ting-Lu ex", "set_name": "Paldea Evolved", "set_id": "sv2", "number": "234", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "250", "types": ["Dark"], "image_small": "https://images.pokemontcg.io/sv2/234.png", "image_large": "https://images.pokemontcg.io/sv2/234_hires.png", "base_price": 8.50},
    {"tcg_id": "sv4-228", "name": "Roaring Moon ex", "set_name": "Paradox Rift", "set_id": "sv4", "number": "228", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "230", "types": ["Dark"], "image_small": "https://images.pokemontcg.io/sv4/228.png", "image_large": "https://images.pokemontcg.io/sv4/228_hires.png", "base_price": 14.00},
    {"tcg_id": "sv4-233", "name": "Iron Valiant ex", "set_name": "Paradox Rift", "set_id": "sv4", "number": "233", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "220", "types": ["Psychic"], "image_small": "https://images.pokemontcg.io/sv4/233.png", "image_large": "https://images.pokemontcg.io/sv4/233_hires.png", "base_price": 11.00},
    {"tcg_id": "base1-10", "name": "Mewtwo", "set_name": "Base Set", "set_id": "base1", "number": "10", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic"], "hp": "60", "types": ["Psychic"], "image_small": "https://images.pokemontcg.io/base1/10.png", "image_large": "https://images.pokemontcg.io/base1/10_hires.png", "base_price": 45.00},
    {"tcg_id": "neo1-9", "name": "Lugia", "set_name": "Neo Genesis", "set_id": "neo1", "number": "9", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic"], "hp": "90", "types": ["Psychic"], "image_small": "https://images.pokemontcg.io/neo1/9.png", "image_large": "https://images.pokemontcg.io/neo1/9_hires.png", "base_price": 120.00},
    {"tcg_id": "swsh1-138", "name": "Zacian V", "set_name": "Sword & Shield", "set_id": "swsh1", "number": "138", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "V"], "hp": "220", "types": ["Metal"], "image_small": "https://images.pokemontcg.io/swsh1/138.png", "image_large": "https://images.pokemontcg.io/swsh1/138_hires.png", "base_price": 5.50},
    {"tcg_id": "sm12-218", "name": "Mewtwo & Mew-GX", "set_name": "Cosmic Eclipse", "set_id": "sm12", "number": "218", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "TAG TEAM"], "hp": "270", "types": ["Psychic"], "image_small": "https://images.pokemontcg.io/sm12/218.png", "image_large": "https://images.pokemontcg.io/sm12/218_hires.png", "base_price": 35.00},
    {"tcg_id": "sv5-222", "name": "Terapagos ex", "set_name": "Temporal Forces", "set_id": "sv5", "number": "222", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic", "ex"], "hp": "230", "types": ["Colorless"], "image_small": "https://images.pokemontcg.io/sv5/222.png", "image_large": "https://images.pokemontcg.io/sv5/222_hires.png", "base_price": 9.00},
    {"tcg_id": "gym1-2", "name": "Blaine's Moltres", "set_name": "Gym Heroes", "set_id": "gym1", "number": "2", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Basic"], "hp": "90", "types": ["Fire"], "image_small": "https://images.pokemontcg.io/gym1/2.png", "image_large": "https://images.pokemontcg.io/gym1/2_hires.png", "base_price": 32.00},
    {"tcg_id": "dp3-1", "name": "Gardevoir", "set_name": "Secret Wonders", "set_id": "dp3", "number": "1", "rarity": "Rare Holo", "supertype": "Pokemon", "subtypes": ["Stage 2"], "hp": "110", "types": ["Psychic"], "image_small": "https://images.pokemontcg.io/dp3/1.png", "image_large": "https://images.pokemontcg.io/dp3/1_hires.png", "base_price": 7.00},
]


def _simulate_price_series(base_price: float, days: int = 90) -> list[float]:
    """Generate realistic price movements using geometric Brownian motion."""
    prices = [base_price]
    daily_vol = 0.03  # 3% daily volatility
    daily_drift = 0.0005  # Slight upward bias

    for _ in range(days - 1):
        change = random.gauss(daily_drift, daily_vol)
        # Add some momentum
        if len(prices) >= 3:
            recent_trend = (prices[-1] - prices[-3]) / prices[-3]
            change += recent_trend * 0.1
        new_price = max(0.01, prices[-1] * (1 + change))
        # Add some periodic patterns (like set releases)
        day_in_cycle = len(prices) % 30
        if day_in_cycle < 3:
            new_price *= 1 + random.uniform(0, 0.02)
        prices.append(round(new_price, 2))
    return prices


def seed_database(db: Session, days: int = 90) -> dict:
    """Seed the database with sample cards and simulated price history."""
    stats = {"cards_created": 0, "prices_created": 0}
    today = date.today()

    for card_data in SAMPLE_CARDS:
        existing = db.query(Card).filter(Card.tcg_id == card_data["tcg_id"]).first()
        if existing:
            continue

        base_price = card_data.pop("base_price")
        card = Card(
            tcg_id=card_data["tcg_id"],
            name=card_data["name"],
            set_name=card_data["set_name"],
            set_id=card_data["set_id"],
            number=card_data["number"],
            rarity=card_data["rarity"],
            supertype=card_data["supertype"],
            subtypes=json.dumps(card_data["subtypes"]),
            hp=card_data["hp"],
            types=json.dumps(card_data["types"]),
            image_small=card_data["image_small"],
            image_large=card_data["image_large"],
            price_variant="holofoil" if "Holo" in card_data["rarity"] else "normal",
        )

        # Generate price history
        price_series = _simulate_price_series(base_price, days)
        card.current_price = price_series[-1]

        db.add(card)
        db.flush()
        stats["cards_created"] += 1

        for i, price in enumerate(price_series):
            price_date = today - timedelta(days=days - 1 - i)
            spread = price * 0.15
            db.add(PriceHistory(
                card_id=card.id,
                date=price_date,
                variant=card.price_variant,
                market_price=price,
                low_price=round(price - spread, 2),
                mid_price=round(price + spread * 0.3, 2),
                high_price=round(price + spread, 2),
            ))
            stats["prices_created"] += 1

    db.commit()
    return stats
