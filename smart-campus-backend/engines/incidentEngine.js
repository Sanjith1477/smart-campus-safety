function classifyCrowd(occupancy) {
  if (occupancy >= 41) return "CRITICAL";
  if (occupancy >= 26) return "HIGH";
  if (occupancy >= 11) return "MEDIUM";
  return "LOW";
}

function evaluateIncident(data) {
  const temperature = Number(data.temperatureC ?? 0);
  const smoke = Number(data.gasIndex ?? 0);
  const flame = Boolean(data.flame);
  const occupancy = Number(data.occupancy ?? 0);
  const motion = Boolean(data.motion);
  const night = Boolean(data.night);
  const sosZone = data.sosZone || "NONE";
  const accessStatus = data.accessStatus || "NONE";
  const zone = data.zone || "LAB";

  let type = "NORMAL";
  let severity = "NORMAL";
  let action = "Continue monitoring.";

  if (sosZone !== "NONE") {
    type = "SOS";
    severity = "CRITICAL";
    action = `Security response required in ${sosZone}.`;
  } else if (flame || (smoke >= 700 && temperature >= 60)) {
    type = "FIRE";
    severity = "CRITICAL";
    action = `Evacuate ${zone}; block affected zone and recalculate safe route.`;
  } else if (smoke >= 500) {
    type = "GAS_SMOKE";
    severity = "HIGH";
    action = `Activate ventilation and avoid ${zone}.`;
  } else if (temperature >= 60) {
    type = "OVERHEATING";
    severity = "HIGH";
    action = `Inspect ${zone} and recalculate route if risk increases.`;
  } else if (occupancy >= 41) {
    type = "CROWD";
    severity = "CRITICAL";
    action = `Restrict movement through ${zone} and recalculate route.`;
  } else if (occupancy >= 26) {
    type = "CROWD";
    severity = "HIGH";
    action = `Increase route cost through ${zone}.`;
  } else if (accessStatus === "DENIED") {
    type = "UNAUTHORIZED_ACCESS";
    severity = night ? "HIGH" : "WARNING";
    action = `Keep the ${zone} door locked and alert security.`;
  } else if (motion && night) {
    type = "NIGHT_MOTION";
    severity = "HIGH";
    action = `Verify movement in ${zone}.`;
  } else if (temperature >= 40 || smoke >= 250) {
    type = "ENVIRONMENT_WARNING";
    severity = "WARNING";
    action = `Monitor ${zone} closely.`;
  }

  return {
    type,
    severity,
    action,
    crowdLevel: classifyCrowd(occupancy)
  };
}

module.exports = { evaluateIncident, classifyCrowd };
