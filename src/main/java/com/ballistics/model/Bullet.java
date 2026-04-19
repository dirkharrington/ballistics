package com.ballistics.model;

/**
 * Represents a known bullet cartridge with its ballistic properties.
 * Ballistic Coefficient (BC) values are G1 standard unless noted.
 * The catalog is loaded at startup from src/main/resources/bullets.yaml.
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
) {}
