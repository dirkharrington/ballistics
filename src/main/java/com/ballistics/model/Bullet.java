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
            )
        );
    }
}
