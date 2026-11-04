package com.ballistics.model;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CompareRequestTest {

    private static final List<String> IDS = List.of("308-win-168gr");

    @Test
    void toTrajectoryRequestWithAllNullsPassesNullsToTrajectoryRequest() {
        CompareRequest req = new CompareRequest(IDS, 100, 500, 25, 0, 0, 15,
            null, null, null, null, null);
        TrajectoryRequest tr = req.toTrajectoryRequest("308-win-168gr");

        // TrajectoryRequest compact constructor applies defaults for null fields
        assertThat(tr.bulletId()).isEqualTo("308-win-168gr");
        assertThat(tr.zeroRangeMeters()).isEqualTo(100);
        assertThat(tr.sightHeightMm()).isEqualTo(38.1);      // default applied
        assertThat(tr.shootingAngleDegrees()).isEqualTo(0.0); // default applied
        assertThat(tr.windDirectionDeg()).isEqualTo(90.0);    // default applied
        assertThat(tr.dragModel()).isEqualTo("G1");           // default applied
    }

    @Test
    void toTrajectoryRequestWithValuesPassesValuesThrough() {
        CompareRequest req = new CompareRequest(IDS, 100, 500, 25, 0, 0, 15,
            50.0, 10.0, 270.0, "G7", null);
        TrajectoryRequest tr = req.toTrajectoryRequest("308-win-168gr");

        assertThat(tr.sightHeightMm()).isEqualTo(50.0);
        assertThat(tr.shootingAngleDegrees()).isEqualTo(10.0);
        assertThat(tr.windDirectionDeg()).isEqualTo(270.0);
        assertThat(tr.dragModel()).isEqualTo("G7");
        assertThat(tr.twistRateInchesPerTurn()).isNull();
    }

    @Test
    void toTrajectoryRequestEqualsDirectConstructionWithSameNulls() {
        CompareRequest req = new CompareRequest(IDS, 100, 500, 25, 8, 200, 10,
            null, null, null, null, null);
        TrajectoryRequest fromCompare = req.toTrajectoryRequest("308-win-168gr");
        TrajectoryRequest direct = new TrajectoryRequest("308-win-168gr",
            100, 500, 25, 8, 200, 10, null, null, null, null, null);

        assertThat(fromCompare).isEqualTo(direct);
    }
}
