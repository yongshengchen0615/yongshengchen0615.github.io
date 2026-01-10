const CONFIG_JSON_URL = "./config.json";

export const config = {
  TITLE: "休假設定（假日）",
  DATE_DB_ENDPOINT: "",
  AUTH_ENDPOINT: "",
  MASTER_ID: "",
  PUBLIC_DASHBOARD_URL: "",
  LIFF_ID: "",
};

function pick_(cfg, key) {
  const v = cfg ? cfg[key] : undefined;
  if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "value")) return v.value;
  return v;
}

export async function loadConfig() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();
  config.TITLE = String(pick_(cfg, "TITLE") || config.TITLE).trim() || "休假設定（假日）";
  config.DATE_DB_ENDPOINT = String(pick_(cfg, "DATE_DB_ENDPOINT") || "").trim();
  config.AUTH_ENDPOINT = String(pick_(cfg, "AUTH_ENDPOINT") || "").trim() || config.DATE_DB_ENDPOINT;
  config.MASTER_ID = String(pick_(cfg, "MASTER_ID") || "").trim();
  config.PUBLIC_DASHBOARD_URL = String(pick_(cfg, "PUBLIC_DASHBOARD_URL") || "").trim();
  config.LIFF_ID = String(pick_(cfg, "LIFF_ID") || "").trim();

  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.DATE_DB_ENDPOINT)) {
    throw new Error("CONFIG_DATE_DB_ENDPOINT_INVALID");
  }

  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.AUTH_ENDPOINT)) {
    throw new Error("CONFIG_AUTH_ENDPOINT_INVALID");
  }
}
