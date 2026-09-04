const api = typeof browser !== "undefined" ? browser : chrome;

async function openHistoryTab() {
  const url = api.runtime.getURL("history.html");
  const existing = await api.tabs.query({ url });
  if (existing.length > 0) {
    await api.tabs.update(existing[0].id, { active: true });
    try {
      if (existing[0].windowId != null && api.windows?.update) {
        await api.windows.update(existing[0].windowId, { focused: true });
      }
    } catch {
      /* focusing the window is optional */
    }
    return;
  }
  await api.tabs.create({ url });
}

api.action.onClicked.addListener(() => {
  openHistoryTab();
});
