"""Curated list of ~150 iconic "blue chip" Pokemon cards to track.

These are the most collectible, valuable, and trader-relevant cards across
all eras. The tcg_id format matches TCGdex: "{set_id}-{card_number}".
"""

BLUE_CHIP_CARDS = [
    # === VINTAGE: Base Set ===
    {"tcg_id": "base1-4", "name": "Charizard", "category": "vintage"},
    {"tcg_id": "base1-2", "name": "Blastoise", "category": "vintage"},
    {"tcg_id": "base1-15", "name": "Venusaur", "category": "vintage"},
    {"tcg_id": "base1-1", "name": "Alakazam", "category": "vintage"},
    {"tcg_id": "base1-10", "name": "Mewtwo", "category": "vintage"},
    {"tcg_id": "base1-6", "name": "Gyarados", "category": "vintage"},
    {"tcg_id": "base1-16", "name": "Zapdos", "category": "vintage"},
    {"tcg_id": "base1-58", "name": "Pikachu", "category": "vintage"},

    # === VINTAGE: Jungle ===
    {"tcg_id": "base2-4", "name": "Jolteon", "category": "vintage"},
    {"tcg_id": "base2-3", "name": "Flareon", "category": "vintage"},
    {"tcg_id": "base2-12", "name": "Vaporeon", "category": "vintage"},
    {"tcg_id": "base2-11", "name": "Snorlax", "category": "vintage"},

    # === VINTAGE: Fossil ===
    {"tcg_id": "base3-4", "name": "Dragonite", "category": "vintage"},
    {"tcg_id": "base3-5", "name": "Gengar", "category": "vintage"},
    {"tcg_id": "base3-10", "name": "Lapras", "category": "vintage"},
    {"tcg_id": "base3-2", "name": "Articuno", "category": "vintage"},

    # === VINTAGE: Team Rocket ===
    {"tcg_id": "base5-4", "name": "Dark Charizard", "category": "vintage"},
    {"tcg_id": "base5-3", "name": "Dark Blastoise", "category": "vintage"},
    {"tcg_id": "base5-5", "name": "Dark Dragonite", "category": "vintage"},

    # === VINTAGE: Gym Challenge ===
    {"tcg_id": "gym2-2", "name": "Blaine's Charizard", "category": "vintage"},
    {"tcg_id": "gym2-16", "name": "Sabrina's Alakazam", "category": "vintage"},

    # === VINTAGE: Promos ===
    {"tcg_id": "basep-1", "name": "Pikachu (Promo)", "category": "vintage"},
    {"tcg_id": "basep-8", "name": "Mew (Promo)", "category": "vintage"},

    # === NEO ERA ===
    {"tcg_id": "neo1-9", "name": "Lugia", "category": "neo"},
    {"tcg_id": "neo1-17", "name": "Typhlosion", "category": "neo"},
    {"tcg_id": "neo2-1", "name": "Espeon", "category": "neo"},
    {"tcg_id": "neo2-13", "name": "Umbreon", "category": "neo"},
    {"tcg_id": "neo2-12", "name": "Tyranitar", "category": "neo"},
    {"tcg_id": "neo3-65", "name": "Shining Gyarados", "category": "neo"},
    {"tcg_id": "neo3-66", "name": "Shining Magikarp", "category": "neo"},
    {"tcg_id": "neo3-7", "name": "Ho-Oh", "category": "neo"},
    {"tcg_id": "neo4-107", "name": "Shining Charizard", "category": "neo"},
    {"tcg_id": "neo4-109", "name": "Shining Mewtwo", "category": "neo"},
    {"tcg_id": "neo4-113", "name": "Shining Tyranitar", "category": "neo"},
    {"tcg_id": "neo4-111", "name": "Shining Raichu", "category": "neo"},
    {"tcg_id": "neo4-11", "name": "Dark Tyranitar", "category": "neo"},

    # === E-CARD ERA ===
    {"tcg_id": "ecard1-6", "name": "Charizard (Expedition)", "category": "ecard"},
    {"tcg_id": "ecard1-4", "name": "Blastoise (Expedition)", "category": "ecard"},
    {"tcg_id": "ecard1-19", "name": "Mew (Expedition)", "category": "ecard"},
    {"tcg_id": "ecard3-146", "name": "Charizard (Skyridge)", "category": "ecard"},
    {"tcg_id": "ecard3-149", "name": "Ho-Oh (Skyridge)", "category": "ecard"},

    # === LEGENDARY COLLECTION ===
    {"tcg_id": "lc-3", "name": "Charizard (LC)", "category": "ecard"},

    # === EX ERA ===
    {"tcg_id": "bw6-85", "name": "Rayquaza EX", "category": "bw"},
    {"tcg_id": "bw4-98", "name": "Mewtwo EX (Full Art)", "category": "bw"},

    # === BW ERA ===
    {"tcg_id": "bw11-19", "name": "Charizard (Legendary Treasures)", "category": "bw"},

    # === XY ERA: Flashfire ===
    {"tcg_id": "xy2-11", "name": "Charizard EX", "category": "xy"},
    {"tcg_id": "xy2-13", "name": "M Charizard EX", "category": "xy"},
    {"tcg_id": "xy2-107", "name": "M Charizard EX (Secret)", "category": "xy"},
    {"tcg_id": "xy2-108", "name": "M Charizard EX (Secret)", "category": "xy"},
    {"tcg_id": "xy2-100", "name": "Charizard EX (Full Art)", "category": "xy"},

    # === XY ERA: Roaring Skies ===
    {"tcg_id": "xy6-76", "name": "M Rayquaza EX (Full Art)", "category": "xy"},
    {"tcg_id": "xy6-106", "name": "Shaymin EX (Full Art)", "category": "xy"},

    # === XY ERA: Evolutions ===
    {"tcg_id": "xy12-11", "name": "Charizard (Evolutions)", "category": "xy"},
    {"tcg_id": "xy12-12", "name": "Charizard EX (Evolutions)", "category": "xy"},
    {"tcg_id": "xy12-13", "name": "M Charizard EX (Evolutions)", "category": "xy"},

    # === XY ERA: Generations ===
    {"tcg_id": "g1-11", "name": "Charizard EX (Generations)", "category": "xy"},

    # === DP ERA ===
    {"tcg_id": "dp7-103", "name": "Charizard (Stormfront)", "category": "dp"},

    # === SUN & MOON ERA ===
    {"tcg_id": "sm1-80", "name": "Umbreon GX", "category": "sm"},
    {"tcg_id": "sm3.5-40", "name": "Shining Mew", "category": "sm"},
    {"tcg_id": "sm3.5-56", "name": "Shining Rayquaza", "category": "sm"},
    {"tcg_id": "sm9-33", "name": "Pikachu & Zekrom GX", "category": "sm"},
    {"tcg_id": "sm10-20", "name": "Reshiram & Charizard GX", "category": "sm"},
    {"tcg_id": "sm11-71", "name": "Mewtwo & Mew GX", "category": "sm"},

    # === SUN & MOON: Hidden Fates ===
    {"tcg_id": "sm115-9", "name": "Charizard GX (Hidden Fates)", "category": "sm"},
    {"tcg_id": "sm115-31", "name": "Mewtwo GX (Hidden Fates)", "category": "sm"},

    # === SUN & MOON: Cosmic Eclipse ===
    {"tcg_id": "sm12-22", "name": "Charizard & Braixen GX", "category": "sm"},
    {"tcg_id": "sm12-156", "name": "Arceus & Dialga & Palkia GX", "category": "sm"},

    # === SWORD & SHIELD: Darkness Ablaze ===
    {"tcg_id": "swsh3-20", "name": "Charizard VMAX", "category": "swsh"},

    # === SWORD & SHIELD: Champion's Path ===
    {"tcg_id": "swsh3.5-74", "name": "Charizard VMAX (Rainbow)", "category": "swsh"},

    # === SWORD & SHIELD: Vivid Voltage ===
    {"tcg_id": "swsh4-44", "name": "Pikachu VMAX", "category": "swsh"},

    # === SWORD & SHIELD: Shining Fates ===
    {"tcg_id": "swsh4.5-SV107", "name": "Charizard VMAX (Shiny)", "category": "swsh"},

    # === SWORD & SHIELD: Evolving Skies (Alt Arts) ===
    {"tcg_id": "swsh7-215", "name": "Umbreon VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh7-218", "name": "Rayquaza VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh7-212", "name": "Sylveon VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh7-209", "name": "Glaceon VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh7-204", "name": "Leafeon VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh7-192", "name": "Dragonite V (Alt Art)", "category": "swsh"},

    # === SWORD & SHIELD: Fusion Strike ===
    {"tcg_id": "swsh8-270", "name": "Espeon VMAX (Alt Art)", "category": "swsh"},
    {"tcg_id": "swsh8-157", "name": "Gengar VMAX", "category": "swsh"},
    {"tcg_id": "swsh8-114", "name": "Mew VMAX", "category": "swsh"},

    # === SWORD & SHIELD: Brilliant Stars ===
    {"tcg_id": "swsh9-174", "name": "Charizard VSTAR (Rainbow)", "category": "swsh"},
    {"tcg_id": "swsh9-153", "name": "Charizard V (Alt Art)", "category": "swsh"},

    # === SWORD & SHIELD: Lost Origin ===
    {"tcg_id": "swsh11-131", "name": "Giratina VSTAR", "category": "swsh"},
    {"tcg_id": "swsh11-201", "name": "Giratina VSTAR (Gold)", "category": "swsh"},

    # === SWORD & SHIELD: Silver Tempest ===
    {"tcg_id": "swsh12-139", "name": "Lugia VSTAR", "category": "swsh"},

    # === SWORD & SHIELD: Crown Zenith ===
    {"tcg_id": "swsh12.5-GG69", "name": "Giratina VSTAR (Galarian Gallery)", "category": "swsh"},

    # === CELEBRATIONS ===
    {"tcg_id": "cel25-4A", "name": "Charizard (Celebrations)", "category": "swsh"},
    {"tcg_id": "cel25-2A", "name": "Blastoise (Celebrations)", "category": "swsh"},
    {"tcg_id": "cel25-15A", "name": "Venusaur (Celebrations)", "category": "swsh"},
    {"tcg_id": "cel25-17A", "name": "Umbreon Star (Celebrations)", "category": "swsh"},

    # === SCARLET & VIOLET: Base ===
    {"tcg_id": "sv01-254", "name": "Koraidon ex (SAR)", "category": "sv"},
    {"tcg_id": "sv01-253", "name": "Miraidon ex (SAR)", "category": "sv"},

    # === SCARLET & VIOLET: Obsidian Flames ===
    {"tcg_id": "sv03-223", "name": "Charizard ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03-228", "name": "Charizard ex (SIR)", "category": "sv"},

    # === SCARLET & VIOLET: 151 ===
    {"tcg_id": "sv03.5-183", "name": "Charizard ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03.5-182", "name": "Venusaur ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03.5-184", "name": "Blastoise ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03.5-188", "name": "Alakazam ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03.5-193", "name": "Mew ex (SAR)", "category": "sv"},
    {"tcg_id": "sv03.5-006", "name": "Charizard ex", "category": "sv"},
    {"tcg_id": "sv03.5-151", "name": "Mew ex", "category": "sv"},

    # === SCARLET & VIOLET: Paldean Fates ===
    {"tcg_id": "sv04.5-234", "name": "Charizard ex (Shiny SIR)", "category": "sv"},

    # === SCARLET & VIOLET: Prismatic Evolutions ===
    {"tcg_id": "sv08.5-161", "name": "Umbreon ex (SAR)", "category": "sv"},
    {"tcg_id": "sv08.5-167", "name": "Eevee ex (SAR)", "category": "sv"},
    {"tcg_id": "sv08.5-179", "name": "Pikachu ex (SIR)", "category": "sv"},
    {"tcg_id": "sv08.5-082", "name": "Lugia ex", "category": "sv"},
    {"tcg_id": "sv08.5-060", "name": "Umbreon ex", "category": "sv"},
]

# Quick lookup set
BLUE_CHIP_TCG_IDS = {card["tcg_id"] for card in BLUE_CHIP_CARDS}
