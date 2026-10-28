// null means inherit; booleans are explicit overrides, including false.
export const TOKEN_SAVER_FEATURES = [
  { key: "rtkEnabled", label: "RTK" },
  { key: "headroomEnabled", label: "Headroom" },
  { key: "cavemanEnabled", label: "Caveman" },
  { key: "ponytailEnabled", label: "Ponytail" },
  { key: "pxpipeEnabled", label: "PXPIPE" },
];

export function normalizeTokenSaverPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Token Saver policy is required");
  const keys = TOKEN_SAVER_FEATURES.map(({ key }) => key);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Unknown Token Saver setting");
  return Object.fromEntries(keys.map((key) => {
    const setting = value[key] === undefined ? null : value[key];
    if (setting !== null && typeof setting !== "boolean") throw new Error(`${key} must be true, false or null`);
    return [key, setting];
  }));
}

export function resolveTokenSaverPolicy(system, workspace = {}, member = {}) {
  const effective = {}, sources = {};
  for (const { key } of TOKEN_SAVER_FEATURES) {
    const source = typeof member[key] === "boolean" ? "member" : typeof workspace[key] === "boolean" ? "workspace" : "system";
    effective[key] = !!({ system, workspace, member }[source][key]);
    sources[key] = source;
  }
  return { effective, sources };
}
