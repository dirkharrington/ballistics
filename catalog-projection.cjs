/**
 * Project raw bullets.yaml entries down to the 8 runtime fields needed by the
 * frontend and physics engine, stripping unread prose (`description`, `caliber`).
 *
 * @param {Array<Record<string, unknown>>} bullets
 * @returns {Array<Record<string, unknown>>}
 */
function projectBulletCatalog(bullets) {
  return bullets.map(({
    id,
    name,
    bulletWeightGrams,
    muzzleVelocityMps,
    ballisticCoefficient,
    bulletDiameterMm,
    muzzleEnergyJoules,
    hexColor,
  }) => ({
    id,
    name,
    bulletWeightGrams,
    muzzleVelocityMps,
    ballisticCoefficient,
    bulletDiameterMm,
    muzzleEnergyJoules,
    hexColor,
  }));
}

module.exports = { projectBulletCatalog };
