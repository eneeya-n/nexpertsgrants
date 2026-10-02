var NAMES = {
  MSN4: "Masnah",
  AFN2: "Affendy",
  SRH8: "Sarah",
  ALY6: "Alliyah",
  HSS3: "Has",
  SZA7: "Shaza",
  SBN5: "Shaabena",
};

export function marketerName(code) {
  return NAMES[String(code || "").trim().toUpperCase()] || "";
}

export function marketerCode(code) {
  var upper = String(code || "").trim().toUpperCase();
  return NAMES[upper] ? upper : "";
}
