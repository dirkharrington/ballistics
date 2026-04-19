package com.ballistics.model;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.*;

class BulletTest {

    @Test
    void knownRifleBulletsReturnsFourBullets() {
        assertThat(Bullet.knownRifleBullets()).hasSize(4);
    }

    @Test
    void knownRifleBulletsContainsExpectedIds() {
        Set<String> ids = Bullet.knownRifleBullets().stream()
            .map(Bullet::id)
            .collect(Collectors.toSet());
        assertThat(ids).containsExactlyInAnyOrder(
            "223-rem-55gr", "308-win-168gr", "3006-150gr", "65-creedmoor-140gr"
        );
    }

    @Test
    void bulletProperties_223Rem() {
        Bullet b = findById("223-rem-55gr");
        assertThat(b.name()).isEqualTo(".223 Rem 55gr FMJ");
        assertThat(b.caliber()).isEqualTo(".223 Remington");
        assertThat(b.bulletWeightGrams()).isEqualTo(3.56);
        assertThat(b.muzzleVelocityMps()).isEqualTo(987.6);
        assertThat(b.ballisticCoefficient()).isEqualTo(0.243);
        assertThat(b.bulletDiameterMm()).isEqualTo(5.69);
        assertThat(b.muzzleEnergyJoules()).isEqualTo(1738.0);
        assertThat(b.hexColor()).isEqualTo("#4ADE80");
        assertThat(b.description()).isNotBlank();
    }

    @Test
    void bulletProperties_308Win() {
        Bullet b = findById("308-win-168gr");
        assertThat(b.bulletWeightGrams()).isEqualTo(10.89);
        assertThat(b.muzzleVelocityMps()).isEqualTo(807.7);
        assertThat(b.ballisticCoefficient()).isEqualTo(0.475);
        assertThat(b.muzzleEnergyJoules()).isEqualTo(3552.0);
        assertThat(b.hexColor()).isEqualTo("#F97316");
    }

    @Test
    void bulletProperties_3006() {
        Bullet b = findById("3006-150gr");
        assertThat(b.bulletWeightGrams()).isEqualTo(9.72);
        assertThat(b.muzzleVelocityMps()).isEqualTo(887.0);
        assertThat(b.ballisticCoefficient()).isEqualTo(0.435);
        assertThat(b.hexColor()).isEqualTo("#60A5FA");
    }

    @Test
    void bulletProperties_65Creedmoor() {
        Bullet b = findById("65-creedmoor-140gr");
        assertThat(b.bulletWeightGrams()).isEqualTo(9.07);
        assertThat(b.muzzleVelocityMps()).isEqualTo(826.0);
        assertThat(b.ballisticCoefficient()).isEqualTo(0.646);
        assertThat(b.bulletDiameterMm()).isEqualTo(6.71);
        assertThat(b.muzzleEnergyJoules()).isEqualTo(3095.0);
        assertThat(b.hexColor()).isEqualTo("#E879F9");
    }

    @Test
    void bulletRecordEquality() {
        Bullet b1 = new Bullet("id", "name", "cal", 55.0, 3000.0, 0.3, 0.224, 1000.0, "desc", "#fff");
        Bullet b2 = new Bullet("id", "name", "cal", 55.0, 3000.0, 0.3, 0.224, 1000.0, "desc", "#fff");
        assertThat(b1).isEqualTo(b2);
        assertThat(b1.hashCode()).isEqualTo(b2.hashCode());
    }

    @Test
    void bulletRecordInequality() {
        Bullet b1 = new Bullet("id-1", "name", "cal", 55.0, 3000.0, 0.3, 0.224, 1000.0, "desc", "#fff");
        Bullet b2 = new Bullet("id-2", "name", "cal", 55.0, 3000.0, 0.3, 0.224, 1000.0, "desc", "#fff");
        assertThat(b1).isNotEqualTo(b2);
    }

    @Test
    void bulletToStringContainsId() {
        Bullet b = new Bullet("test-id", "name", "cal", 55.0, 3000.0, 0.3, 0.224, 1000.0, "desc", "#fff");
        assertThat(b.toString()).contains("test-id");
    }

    @Test
    void allKnownBulletsHavePositivePhysicalProperties() {
        Bullet.knownRifleBullets().forEach(b -> {
            assertThat(b.bulletWeightGrams()).isGreaterThan(0);
            assertThat(b.muzzleVelocityMps()).isGreaterThan(0);
            assertThat(b.ballisticCoefficient()).isGreaterThan(0);
            assertThat(b.bulletDiameterMm()).isGreaterThan(0);
            assertThat(b.muzzleEnergyJoules()).isGreaterThan(0);
        });
    }

    @Test
    void knownRifleBulletsIsImmutable() {
        List<Bullet> bullets = Bullet.knownRifleBullets();
        assertThatThrownBy(() -> bullets.add(bullets.get(0)))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    private static Bullet findById(String id) {
        return Bullet.knownRifleBullets().stream()
            .filter(b -> b.id().equals(id)).findFirst().orElseThrow();
    }
}
