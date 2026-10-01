import {
  createActivation,
  initBadge,
  logFailure,
  refreshActiveTitles,
  refreshTitle,
} from "./activation.js";
import contentScript from "./content/content.ts?script";
import { handle } from "./handlers.js";
import { browser } from "./lib/browser.js";
import { onPairTabUpdated } from "./pairing.js";

const activation = createActivation(contentScript);

browser.runtime.onInstalled.addListener(() => {
  logFailure("badge", initBadge());
  logFailure("titles", refreshActiveTitles());
});

browser.runtime.onStartup.addListener(() => {
  logFailure("badge", initBadge());
  logFailure("titles", refreshActiveTitles());
});

browser.action.onClicked.addListener((tab) => {
  logFailure("toolbar click", activation.onActionClicked(tab));
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  logFailure("title", refreshTitle(tabId));
});

browser.tabs.onRemoved.addListener((tabId) => {
  logFailure("tab cleanup", activation.onTabRemoved(tabId));
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  logFailure("tab update", activation.onTabUpdated(tabId, changeInfo));
  logFailure("pairing relay", onPairTabUpdated(tabId, changeInfo));
});

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handle(message, sender, browser.runtime.id).then(sendResponse);
  return true;
});
