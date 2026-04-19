package com.ballistics.model;

/**
 * Represents a known bullet cartridge with its ballistic properties.
 * Ballistic Coefficient (BC) values are G1 standard unless noted.
 */
public record Bullet(
    String id,
    String name,
    String caliber,
    double bulletWeightGrams,
    double muzzleVelocityMps,
    double ballisticCoefficient,
    double bulletDiameterMm,
    double muzzleEnergyJoules,
    String description,
    String hexColor
) {

    /**
     * Factory method returning a catalog of well-known rifle cartridges
     * with real-world ballistic data from published load data.
     */
    public static java.util.List<Bullet> knownRifleBullets() {
        return java.util.List.of(

            // .223 Remington / 5.56 NATO — 55gr FMJ (standard NATO load)
            new Bullet(
                "223-rem-55gr",
                ".223 Rem 55gr FMJ",
                ".223 Remington",
                3.56,
                987.6,
                0.243,
                5.69,
                1738.0,
                "Standard AR-15 / M16 loading. High velocity, flat trajectory at shorter ranges. " +
                "Popular varmint and defensive round. Loses energy quickly beyond 400 metres.",
                "#4ADE80"
            ),

            // .308 Winchester / 7.62x51 NATO — 168gr Sierra MatchKing
            new Bullet(
                "308-win-168gr",
                ".308 Win 168gr BTHP",
                ".308 Winchester",
                10.89,
                807.7,
                0.475,
                7.82,
                3552.0,
                "The gold standard precision rifle cartridge. 168gr Sierra MatchKing is the " +
                "benchmark for long-range accuracy. Favoured by military snipers and competition shooters.",
                "#F97316"
            ),

            // .30-06 Springfield — 150gr Nosler Ballistic Tip
            new Bullet(
                "3006-150gr",
                ".30-06 Springfield 150gr",
                ".30-06 Springfield",
                9.72,
                887.0,
                0.435,
                7.82,
                3823.0,
                "The legendary American hunting cartridge. Over a century of service. " +
                "Excellent all-around performance for North American game at hunting distances.",
                "#60A5FA"
            ),

            // 6.5 Creedmoor — 140gr Hornady ELD Match
            new Bullet(
                "65-creedmoor-140gr",
                "6.5 Creedmoor 140gr ELD",
                "6.5 Creedmoor",
                9.07,
                826.0,
                0.646,
                6.71,
                3095.0,
                "The modern long-range precision king. Exceptionally high BC for caliber means " +
                "superb wind resistance and minimal drop. Dominates PRS competition. Low recoil.",
                "#E879F9"
            ),

            // .243 Winchester — 95gr Nosler Ballistic Tip
            new Bullet(
                "243-win-95gr",
                ".243 Win 95gr BT",
                ".243 Winchester",
                6.16,
                920.0,
                0.379,
                5.94,
                2608.0,
                "Popular varmint-to-deer cartridge. Low recoil with a flat trajectory. " +
                "The 95gr Ballistic Tip is a versatile hunting load with excellent terminal performance.",
                "#34D399"
            ),

            // .270 Winchester — 130gr Nosler AccuBond
            new Bullet(
                "270-win-130gr",
                ".270 Win 130gr AccuBond",
                ".270 Winchester",
                8.42,
                939.0,
                0.480,
                6.99,
                3714.0,
                "Jack O'Connor's favourite. High velocity with a flat trajectory. " +
                "Excellent all-around North American hunting cartridge. Mild recoil for its power.",
                "#FBBF24"
            ),

            // 7mm Remington Magnum — 160gr Nosler Partition
            new Bullet(
                "7mm-rem-mag-160gr",
                "7mm Rem Mag 160gr Partition",
                "7mm Remington Magnum",
                10.36,
                930.0,
                0.531,
                7.21,
                4484.0,
                "A premier long-range hunting cartridge. High BC 160gr bullet retains energy " +
                "exceptionally well. Widely used for elk and larger game at extended ranges.",
                "#F87171"
            ),

            // .338 Lapua Magnum — 250gr Sierra MatchKing
            new Bullet(
                "338-lapua-250gr",
                ".338 Lapua 250gr SMK",
                ".338 Lapua Magnum",
                16.20,
                905.0,
                0.587,
                8.61,
                6640.0,
                "Elite military and precision long-range cartridge. Effective past 1500 metres. " +
                "Punishing recoil, but unmatched downrange energy retention among standard calibers.",
                "#A78BFA"
            ),

            // 6mm Creedmoor — 108gr Berger Hybrid
            new Bullet(
                "6mm-creedmoor-108gr",
                "6mm Creedmoor 108gr Hybrid",
                "6mm Creedmoor",
                7.00,
                885.0,
                0.536,
                6.17,
                2740.0,
                "PRS competition favourite. Very high BC for caliber with minimal recoil. " +
                "Superb wind resistance. Increasingly popular in long-range precision rifle competition.",
                "#2DD4BF"
            ),

            // .300 Winchester Magnum — 190gr Sierra MatchKing
            new Bullet(
                "300-win-mag-190gr",
                ".300 Win Mag 190gr SMK",
                ".300 Winchester Magnum",
                12.31,
                930.0,
                0.533,
                7.82,
                5330.0,
                "The most widely used long-range military sniper cartridge. Hits hard past 1000 metres. " +
                "Balances power, BC, and availability. Popular in F-Class and tactical competitions.",
                "#FB923C"
            )
        );
    }
}
