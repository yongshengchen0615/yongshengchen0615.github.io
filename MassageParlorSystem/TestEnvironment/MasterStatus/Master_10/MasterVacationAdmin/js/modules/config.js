const CONFIG_JSON_URL = "./config.json";

export const config = {
  TITLE: "休假設定（假日）",
  DATE_DB_ENDPOINT: "",
};

export async function loadConfig() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();
  config.TITLE = String(cfg.TITLE || config.TITLE).trim() || "休假設定（假日）";
  config.DATE_DB_ENDPOINT = String(cfg.DATE_DB_ENDPOINT || "").trim();

  if (!/^https:\/\/script.google.com\/.+\/exec$/.test(config.DATE_DB_ENDPOINT)) {
    throw new Error("CONFIG_DATE_DB_ENDPOINT_INVALID");
  }
}
