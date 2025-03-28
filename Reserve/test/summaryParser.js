export function parseSummaryToFormData(summaryText) {
    const lines = summaryText.split("\n").map(l => l.trim());
    const data = { people: [] };
    const typeMap = {
      "本人預約": "self",
      "代訂他人": "other"
    };
  
    let currentPerson = null;
  
    for (let line of lines) {
      if (line.startsWith("- 預約類型：")) {
        const txt = line.replace("- 預約類型：", "").trim();
        data.type = typeMap[txt] || "";
      } else if (line.startsWith("📅 日期：")) {
        data.date = line.replace("📅 日期：", "").split("（")[0].trim();
      } else if (line.startsWith("⏰ 時間：")) {
        data.time = line.replace("⏰ 時間：", "").trim();
      } else if (line.startsWith("👤 姓名：")) {
        data.name = line.replace("👤 姓名：", "").trim();
      } else if (line.startsWith("📞 電話：")) {
        data.phone = line.replace("📞 電話：", "").trim();
      } else if (line.startsWith("👥 人數：")) {
        data.numPeople = line.replace("👥 人數：", "").replace("人", "").trim();
      } else if (line.startsWith("👤 預約人")) {
        currentPerson = { main: [], addon: [], note: "" };
        data.people.push(currentPerson);
      } else if (line.startsWith("- 服務內容：")) {
        const list = line.replace("- 服務內容：", "").split(",").map(s => s.trim());
        currentPerson.main = list;
      } else if (line.startsWith("- 備註：")) {
        const note = line.replace("- 備註：", "").trim();
        currentPerson.note = (note === "（無）") ? "" : note;
      }
    }
  
    return data;
  }
  