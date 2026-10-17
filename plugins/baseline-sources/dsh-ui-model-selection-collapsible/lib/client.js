window.__ModuleLoader__.load({ id: "@local/dsh-ui-model-selection-collapsible", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/CollapsibleModelSelect.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");
var import_react_dom = require("react-dom");

// node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}
var clsx_default = clsx;

// src/client/CollapsibleModelSelect.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/model-select.css
var tagId = "@local/dsh-ui-model-selection-collapsible/model-select.css";
if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@local/dsh-ui-model-selection-collapsible";
  tag.dataset.pluginCss = tagId;
  tag.textContent = ".dsh-cmsc-v2-root {\r\n  position: relative;\r\n  min-width: 0;\r\n}\r\n\r\n/* Figma 313:14108 ToggleButton: 13/20 regular secondary label, 4px gap,\r\n   12px caption chevron; 28px chip height matches the sibling Plan /\r\n   Read-only selects in the same tool row. */\r\n.dsh-cmsc-v2-trigger {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n  min-width: 0;\r\n  /* Legacy fallback, then a row-relative cap that grants long names more\r\n     room without letting this trailing control consume the composer. */\r\n  max-width: 220px;\r\n  max-width: min(360px, 45cqw);\r\n  height: 28px;\r\n  padding: 0 4px 0 8px;\r\n  border: none;\r\n  /* Rounded chip chrome, matching the sibling permission trigger. */\r\n  border-radius: var(--dsw-radius-sm);\r\n  outline: none;\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-secondary);\r\n  font-size: 13px;\r\n  line-height: 20px;\r\n  font-weight: 400;\r\n  cursor: pointer;\r\n}\r\n\r\n.dsh-cmsc-v2-trigger:hover:not(:disabled) {\r\n  background: var(--dsw-alias-interactive-bg-hover);\r\n}\r\n\r\n.dsh-cmsc-v2-trigger:focus-visible:not([data-selection-focus]) {\r\n  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\r\n}\r\n\r\n.dsh-cmsc-v2-trigger:disabled {\r\n  color: var(--dsw-alias-label-dimmed);\r\n  cursor: default;\r\n}\r\n\r\n.dsh-cmsc-v2-triggerLabel {\r\n  min-width: 0;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n/* Effort value beside the model name (mock's 'High': same 13/20/400, caption\r\n   tone). Adaptive priority: the huge shrink factor makes the effort absorb\r\n   all deficit first \u2014 it ellipsizes away to nothing before the model name\r\n   loses a single pixel, and the chevron stays snug throughout. */\r\n.dsh-cmsc-v2-triggerEffort {\r\n  flex-shrink: 1000;\r\n  min-width: 0;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  color: var(--dsw-alias-label-caption);\r\n}\r\n\r\n/* The Models glyph replaces the text when the composer row cannot fit it. */\r\n.dsh-cmsc-v2-triggerIcon {\r\n  display: var(--dsh-composer-model-icon-display, none);\r\n  flex: 0 0 auto;\r\n}\r\n\r\n/* The composer measures expanded row demand and owns these display variables.\r\n   Outside a composer, the trigger retains its text. */\r\n.dsh-cmsc-v2-triggerLabel,\r\n.dsh-cmsc-v2-triggerEffort {\r\n  display: var(--dsh-composer-model-text-display, block);\r\n}\r\n\r\n.dsh-cmsc-v2-chevron {\r\n  flex: 0 0 auto;\r\n  color: var(--dsw-alias-label-caption);\r\n  transition: transform 120ms ease;\r\n}\r\n\r\n.dsh-cmsc-v2-chevronOpen {\r\n  transform: rotate(180deg);\r\n}\r\n\r\n/* Portaled to body and placed from the trigger rect by the component (the\r\n   Menu primitive's portal rules), so the sidebar and the columns' overflow\r\n   clips cannot crop it; z matches the primitive's .dsh-cmsc-v2-portal layer. */\r\n.dsh-cmsc-v2-menu {\r\n  position: fixed;\r\n  z-index: 1100;\r\n  display: flex;\r\n  flex-direction: column;\r\n  /* Let the visible pane's rows set the card width, but keep pathological ids\r\n     and narrow screens inside a bounded card where ellipsis remains. */\r\n  width: max-content;\r\n  min-width: min(240px, calc(100vw - 32px));\r\n  max-width: min(420px, calc(100vw - 32px));\r\n  max-height: min(360px, calc(100vh - 96px));\r\n  overflow: hidden;\r\n  padding: 4px;\r\n  /* Surface tokens match the Menu primitive card (ui-primitives\r\n   * Menu.module.css) so every dropdown reads as the same material. */\r\n  border: 0;\r\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\r\n  box-shadow: var(--dsw-elevation-prominent);\r\n  color: var(--dsw-alias-label-primary);\r\n  /* Elevated surface: the scrollbar thumb takes the l2 elevation tokens.\r\n     Declared here rather than on the scrolling `.dsh-cmsc-v2-groups` child so the\r\n     elevation choice sits with the surface; the custom properties inherit\r\n     down to whichever descendant actually scrolls (see ui-theme\r\n     styles/scrollbar.css for the rebinding contract). */\r\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\r\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\r\n}\r\n\r\n.dsh-cmsc-v2-status,\r\n.dsh-cmsc-v2-empty {\r\n  padding: 8px;\r\n  color: var(--dsw-alias-label-tertiary);\r\n  font-size: 12px;\r\n  line-height: 18px;\r\n}\r\n\r\n.dsh-cmsc-v2-error,\r\n.dsh-cmsc-v2-warning {\r\n  display: flex;\r\n  align-items: flex-start;\r\n  justify-content: space-between;\r\n  gap: 6px;\r\n  margin-bottom: 3px;\r\n  padding: 6px 7px;\r\n  border-radius: var(--dsw-radius-md);\r\n  background: var(--dsw-alias-interactive-bg-hover-danger);\r\n  color: var(--dsw-alias-state-error-primary);\r\n  font-size: 11px;\r\n  line-height: 16px;\r\n}\r\n\r\n.dsh-cmsc-v2-warning {\r\n  background: var(--dsw-alias-bg-module-platform);\r\n  color: var(--dsw-alias-state-warn-label);\r\n}\r\n\r\n.dsh-cmsc-v2-retry {\r\n  flex: 0 0 auto;\r\n  padding: 0;\r\n  border: none;\r\n  background: transparent;\r\n  color: inherit;\r\n  font: inherit;\r\n  font-weight: 600;\r\n  cursor: pointer;\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow {\r\n  position: relative;\r\n  flex-shrink: 0;\r\n  margin: 2px 0 3px;\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow .dsh-cmsc-v2-search {\r\n  display: flex;\r\n  height: auto;\r\n  padding: 5px 7px;\r\n  border: 0 solid transparent;\r\n  border-radius: var(--dsw-radius-md);\r\n  background: transparent;\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow .dsh-cmsc-v2-searchWithQuery {\r\n  padding-right: 34px;\r\n}\r\n\r\n.dsh-cmsc-v2-searchClear {\r\n  position: absolute;\r\n  top: 50%;\r\n  right: 4px;\r\n  transform: translateY(-50%);\r\n  display: inline-flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  width: 24px;\r\n  height: 24px;\r\n  padding: 0;\r\n  border: none;\r\n  border-radius: 50%;\r\n  corner-shape: round;\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-secondary);\r\n  cursor: pointer;\r\n}\r\n\r\n.dsh-cmsc-v2-searchClear:hover,\r\n.dsh-cmsc-v2-searchClear:focus-visible {\r\n  outline: none;\r\n  background: var(--dsw-alias-interactive-bg-hover);\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow .dsh-cmsc-v2-search:focus-within {\r\n  border-color: transparent;\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow .dsh-cmsc-v2-search input {\r\n  padding: 0;\r\n  font-size: 12px;\r\n  line-height: normal;\r\n}\r\n\r\n.dsh-cmsc-v2-searchRow .dsh-cmsc-v2-search input::placeholder {\r\n  color: var(--dsw-alias-label-caption);\r\n}\r\n\r\n.dsh-cmsc-v2-groups {\r\n  min-height: 0;\r\n  overflow-y: auto;\r\n}\r\n\r\n.dsh-cmsc-v2-option {\r\n  box-sizing: border-box;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  width: auto;\r\n  min-width: 100%;\r\n  min-height: 34px;\r\n  padding: 5px 7px;\r\n  border: none;\r\n  border-radius: var(--dsw-radius-md);\r\n  outline: none;\r\n  background: transparent;\r\n  color: inherit;\r\n  text-align: left;\r\n  cursor: pointer;\r\n}\r\n\r\n.dsh-cmsc-v2-option:not(.dsh-cmsc-v2-modelOption):hover:not(:disabled),\r\n.dsh-cmsc-v2-option:focus-visible,\r\n.dsh-cmsc-v2-optionActive:not(:disabled) {\r\n  background: var(--dsw-alias-interactive-bg-hover);\r\n}\r\n\r\n/* Selection marker is the trailing check, not a fill \u2014 matches the Menu\r\n * primitive's selected treatment. */\r\n.dsh-cmsc-v2-selected {\r\n  background: transparent;\r\n}\r\n\r\n.dsh-cmsc-v2-option:disabled {\r\n  color: var(--dsw-alias-label-dimmed);\r\n  cursor: default;\r\n}\r\n\r\n.dsh-cmsc-v2-optionCopy {\r\n  display: flex;\r\n  flex: 1;\r\n  flex-direction: column;\r\n  min-width: 0;\r\n}\r\n\r\n.dsh-cmsc-v2-modelName {\r\n  overflow: hidden;\r\n  color: inherit;\r\n  font-size: 13px;\r\n  line-height: 18px;\r\n  font-weight: 400;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n.dsh-cmsc-v2-check {\r\n  display: grid;\r\n  place-items: center;\r\n  flex: 0 0 14px;\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.dsh-cmsc-v2-check svg {\r\n  width: 14px;\r\n  height: 14px;\r\n}\r\n\r\n/* Two-level root cells use the same compact rhythm as the model rows. */\r\n.dsh-cmsc-v2-cell {\r\n  box-sizing: border-box;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 6px;\r\n  width: auto;\r\n  min-width: 100%;\r\n  height: 34px;\r\n  padding: 0 8px;\r\n  border: none;\r\n  border-radius: var(--dsw-radius-md);\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-primary);\r\n  font-size: 13px;\r\n  line-height: 20px;\r\n  cursor: pointer;\r\n  text-align: left;\r\n  outline: none;\r\n}\r\n\r\n.dsh-cmsc-v2-cell:hover,\r\n.dsh-cmsc-v2-cell:focus-visible {\r\n  background: var(--dsw-alias-interactive-bg-hover);\r\n}\r\n\r\n.dsh-cmsc-v2-cellLabel {\r\n  flex: 0 0 auto;\r\n  white-space: nowrap;\r\n}\r\n\r\n.dsh-cmsc-v2-cellValue {\r\n  flex: 1 1 auto;\r\n  min-width: 0;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  text-align: right;\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.dsh-cmsc-v2-cellChevron {\n  flex: 0 0 auto;\n  width: 12px;\n  height: 12px;\n  color: var(--dsw-alias-menu-icon);\n}\n\n/* Provider disclosure is layered over the 0.2.0-rc.2 model menu. */\n.dsh-cmsc-v2-group {\n  position: relative;\n}\n\n.dsh-cmsc-v2-groupHeader {\n  position: sticky;\n  top: 0;\n  z-index: 1;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  width: 100%;\n  min-height: 30px;\n  padding: 5px 7px;\n  border: 0;\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-module-platform);\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n  text-align: left;\n  cursor: pointer;\n}\n\n.dsh-cmsc-v2-groupHeader:hover:not(:disabled),\n.dsh-cmsc-v2-groupHeader:focus-visible {\n  outline: none;\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-v2-groupHeader:disabled {\n  cursor: default;\n}\n\n.dsh-cmsc-v2-groupTitle {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-v2-groupCount {\n  color: var(--dsw-alias-label-caption);\n}\n\n.dsh-cmsc-v2-groupBody {\n  display: grid;\n  grid-template-rows: 1fr;\n  opacity: 1;\n  transition: grid-template-rows 160ms ease, opacity 160ms ease;\n}\n\n.dsh-cmsc-v2-groupBody[data-expanded='false'] {\n  grid-template-rows: 0fr;\n  opacity: 0;\n  visibility: hidden;\n  transition: grid-template-rows 160ms ease, opacity 160ms ease, visibility 0s linear 160ms;\n}\n\n.dsh-cmsc-v2-groupBodyInner {\n  min-height: 0;\n  overflow: hidden;\n}\n\n.dsh-cmsc-v2-modelDescription {\n  overflow: hidden;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 16px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-v2-menu[data-density='compact'] .dsh-cmsc-v2-groupHeader {\n  min-height: 26px;\n  padding-block: 3px;\n}\n\n.dsh-cmsc-v2-menu[data-density='compact'] .dsh-cmsc-v2-option {\n  min-height: 28px;\n  padding-block: 3px;\n}\n\n.dsh-cmsc-v2-menu[data-density='compact'] .dsh-cmsc-v2-modelDescription {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  overflow: hidden;\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n.dsh-cmsc-v2-menu[data-motion='none'] .dsh-cmsc-v2-groupBody,\n.dsh-cmsc-v2-menu[data-motion='none'] .dsh-cmsc-v2-groupBody[data-expanded='false'] {\n  transition: none;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-cmsc-v2-groupBody,\n  .dsh-cmsc-v2-groupBody[data-expanded='false'] {\n    transition: none;\n  }\n}\n";
  document.head.appendChild(tag);
}

// src/client/styles.css
var tagId2 = "@local/dsh-ui-model-selection-collapsible/styles.css";
if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId2 + '"]') === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@local/dsh-ui-model-selection-collapsible";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = ".dsh-cmsc-root {\n  min-width: 0;\n  position: relative;\n  --dsh-cmsc-motion-duration: 160ms;\n  --dsh-cmsc-motion-easing: cubic-bezier(0.4, 0, 0.6, 1);\n}\n\n.dsh-cmsc-trigger {\n  min-width: 0;\n  max-width: 220px;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n  background: transparent;\n  border: 0;\n  border-radius: 24px;\n  outline: none;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 0 4px 0 8px;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.dsh-cmsc-trigger:hover:not(:disabled),\n.dsh-cmsc-trigger:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-trigger:focus-visible {\n  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);\n}\n\n.dsh-cmsc-trigger:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n.dsh-cmsc-triggerLabel {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-triggerEffort,\n.dsh-cmsc-chevron,\n.dsh-cmsc-cellChevron {\n  color: var(--dsw-alias-label-caption);\n  flex: none;\n}\n\n.dsh-cmsc-chevron {\n  transition: transform var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing);\n}\n\n.dsh-cmsc-chevronOpen {\n  transform: rotate(180deg);\n}\n\n.dsh-cmsc-menu {\n  z-index: 20;\n  width: min(260px, calc(100vw - 32px));\n  max-height: min(420px, calc(100vh - 96px));\n  position: absolute;\n  right: 0;\n  bottom: calc(100% + 8px);\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  padding: 4px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-specific-menu);\n  border: 1px solid var(--dsw-alias-border-inverted);\n  border-radius: 12px;\n  box-shadow: var(--dsw-shadow-lv3);\n  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);\n  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);\n}\n\n.dsh-cmsc-status,\n.dsh-cmsc-empty {\n  padding: 10px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dsh-cmsc-error,\n.dsh-cmsc-warning {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 8px;\n  margin-bottom: 4px;\n  padding: 7px 8px;\n  color: var(--dsw-alias-state-error-primary);\n  background: var(--dsw-alias-interactive-bg-hover-danger);\n  border-radius: 8px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dsh-cmsc-warning {\n  color: var(--dsw-alias-state-warn-label);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dsh-cmsc-retry {\n  flex: none;\n  padding: 0;\n  color: inherit;\n  cursor: pointer;\n  background: transparent;\n  border: 0;\n  font: inherit;\n  font-weight: 600;\n}\n\n.dsh-cmsc-retry:focus-visible {\n  outline: 2px solid currentColor;\n  outline-offset: 2px;\n}\n\n.dsh-cmsc-groups {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.dsh-cmsc-group + .dsh-cmsc-group {\n  margin-top: 4px;\n}\n\n.dsh-cmsc-groupHeader {\n  width: 100%;\n  min-height: 32px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 5px 8px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: left;\n  cursor: pointer;\n  background: transparent;\n  border: 0;\n  border-radius: 8px;\n  outline: none;\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 20px;\n}\n\n.dsh-cmsc-groupHeader:hover:not(:disabled),\n.dsh-cmsc-groupHeader:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-groupHeader:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n.dsh-cmsc-groupTitle {\n  min-width: 0;\n  flex: 1;\n  overflow: hidden;\n  color: var(--dsw-alias-label-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-groupCount {\n  flex: none;\n  color: var(--dsw-alias-label-caption);\n  font-size: 12px;\n  font-weight: 400;\n  line-height: 18px;\n}\n\n.dsh-cmsc-groupBody {\n  min-width: 0;\n  display: grid;\n  grid-template-rows: 1fr;\n  opacity: 1;\n  visibility: visible;\n  pointer-events: auto;\n  transition:\n    grid-template-rows var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing),\n    opacity var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing),\n    visibility 0s linear 0s;\n}\n\n.dsh-cmsc-groupBody[data-expanded='false'] {\n  grid-template-rows: 0fr;\n  opacity: 0;\n  visibility: hidden;\n  pointer-events: none;\n  transition:\n    grid-template-rows var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing),\n    opacity var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing),\n    visibility 0s linear var(--dsh-cmsc-motion-duration);\n}\n\n.dsh-cmsc-groupBodyInner {\n  min-height: 0;\n  overflow: hidden;\n  display: flex;\n  flex-direction: column;\n  transform: translateY(0);\n  transition: transform var(--dsh-cmsc-motion-duration) var(--dsh-cmsc-motion-easing);\n}\n\n.dsh-cmsc-groupBody[data-expanded='false'] .dsh-cmsc-groupBodyInner {\n  transform: translateY(-4px);\n}\n\n.dsh-cmsc-option {\n  width: 100%;\n  min-height: 38px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 8px;\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: transparent;\n  border: 0;\n  border-radius: 10px;\n  outline: none;\n}\n\n.dsh-cmsc-option:hover:not(:disabled),\n.dsh-cmsc-option:focus-visible,\n.dsh-cmsc-selected {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-option:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n.dsh-cmsc-optionCopy {\n  min-width: 0;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n}\n\n.dsh-cmsc-modelName,\n.dsh-cmsc-description {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-modelName {\n  color: inherit;\n  font-size: 14px;\n  font-weight: 500;\n  line-height: 20px;\n}\n\n.dsh-cmsc-description {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dsh-cmsc-check {\n  flex: 0 0 18px;\n  display: grid;\n  place-items: center;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-cmsc-cell {\n  width: 100%;\n  height: 40px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 0 10px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n  text-align: left;\n  background: transparent;\n  border: 0;\n  border-radius: 10px;\n  outline: none;\n  font-size: 14px;\n  line-height: 22px;\n}\n\n.dsh-cmsc-cell:hover,\n.dsh-cmsc-cell:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-cellLabel,\n.dsh-cmsc-cellValue {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.dsh-cmsc-cellLabel {\n  flex: auto;\n}\n\n.dsh-cmsc-cellValue {\n  flex: 0 1 auto;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dsh-cmsc-root[data-density='compact'] .dsh-cmsc-groupHeader {\n  min-height: 28px;\n  padding-block: 3px;\n}\n\n.dsh-cmsc-root[data-density='compact'] .dsh-cmsc-option {\n  min-height: 32px;\n  padding-block: 4px;\n}\n\n.dsh-cmsc-root[data-density='compact'] .dsh-cmsc-description {\n  width: 1px;\n  height: 1px;\n  position: absolute;\n  overflow: hidden;\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n.dsh-cmsc-root[data-motion='none'] .dsh-cmsc-chevron,\n.dsh-cmsc-root[data-motion='none'] .dsh-cmsc-groupBody,\n.dsh-cmsc-root[data-motion='none'] .dsh-cmsc-groupBody[data-expanded='false'],\n.dsh-cmsc-root[data-motion='none'] .dsh-cmsc-groupBodyInner {\n  transition: none;\n}\n\n.dsh-cmsc-root[data-motion='none'] .dsh-cmsc-groupBodyInner,\n.dsh-cmsc-root[data-motion='none']\n  .dsh-cmsc-groupBody[data-expanded='false']\n  .dsh-cmsc-groupBodyInner {\n  transform: none;\n}\n\n.dsh-cmsc-settingsSection {\n  width: min(680px, 100%);\n  display: flex;\n  flex-direction: column;\n  gap: 24px;\n  padding: 4px 0 28px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-cmsc-settingsHeader {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.dsh-cmsc-settingsTitle {\n  margin: 0;\n  font-size: 22px;\n  font-weight: 650;\n  line-height: 30px;\n}\n\n.dsh-cmsc-settingsIntro,\n.dsh-cmsc-settingsScope,\n.dsh-cmsc-settingsDescription {\n  margin: 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dsh-cmsc-settingsScope {\n  width: fit-content;\n  padding: 6px 9px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n  border-radius: 8px;\n}\n\n.dsh-cmsc-settingsGroup {\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border: 0;\n}\n\n.dsh-cmsc-settingsLegend {\n  padding: 0;\n  color: var(--dsw-alias-label-primary);\n  font-size: 15px;\n  font-weight: 600;\n  line-height: 22px;\n}\n\n.dsh-cmsc-settingsDescription {\n  margin-top: 3px;\n}\n\n.dsh-cmsc-settingsChoices {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n  margin-top: 10px;\n}\n\n.dsh-cmsc-settingsChoice {\n  min-width: 0;\n  min-height: 70px;\n  position: relative;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) 20px;\n  align-items: center;\n  gap: 10px;\n  padding: 11px 12px;\n  cursor: pointer;\n  background: var(--dsw-alias-bg-module-platform);\n  border: 1px solid var(--dsw-alias-border-l3);\n  border-radius: 12px;\n}\n\n.dsh-cmsc-settingsChoice:hover,\n.dsh-cmsc-settingsChoice[data-selected='true'] {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-settingsChoice[data-selected='true'] {\n  border-color: var(--dsw-alias-label-secondary);\n}\n\n.dsh-cmsc-settingsChoice:has(.dsh-cmsc-settingsRadio:focus-visible) {\n  outline: 2px solid var(--dsw-alias-border-l3);\n  outline-offset: 2px;\n}\n\n.dsh-cmsc-settingsRadio {\n  width: 1px;\n  height: 1px;\n  position: absolute;\n  overflow: hidden;\n  clip: rect(0 0 0 0);\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n\n.dsh-cmsc-settingsChoiceCopy {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.dsh-cmsc-settingsChoiceTitle {\n  color: var(--dsw-alias-label-primary);\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 20px;\n}\n\n.dsh-cmsc-settingsChoiceDescription {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dsh-cmsc-settingsChoiceCheck {\n  width: 20px;\n  height: 20px;\n  display: grid;\n  place-items: center;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dsh-cmsc-settingsReset {\n  width: fit-content;\n  min-height: 32px;\n  padding: 5px 12px;\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n  background: transparent;\n  border: 1px solid var(--dsw-alias-border-l3);\n  border-radius: 9px;\n  font: inherit;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dsh-cmsc-settingsReset:hover:not(:disabled),\n.dsh-cmsc-settingsReset:focus-visible {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dsh-cmsc-settingsReset:focus-visible {\n  outline: 2px solid var(--dsw-alias-border-l3);\n  outline-offset: 2px;\n}\n\n.dsh-cmsc-settingsReset:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  cursor: default;\n}\n\n@media (max-width: 640px) {\n  .dsh-cmsc-settingsChoices {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-cmsc-chevron,\n  .dsh-cmsc-groupBody,\n  .dsh-cmsc-groupBody[data-expanded='false'],\n  .dsh-cmsc-groupBodyInner {\n    transition: none;\n  }\n\n  .dsh-cmsc-groupBodyInner,\n  .dsh-cmsc-groupBody[data-expanded='false'] .dsh-cmsc-groupBodyInner {\n    transform: none;\n  }\n}\n";
  document.head.appendChild(tag);
}

// src/client/model-select-styles.ts
var styles = {
  cell: "dsh-cmsc-v2-cell",
  cellChevron: "dsh-cmsc-v2-cellChevron",
  cellLabel: "dsh-cmsc-v2-cellLabel",
  cellValue: "dsh-cmsc-v2-cellValue",
  check: "dsh-cmsc-v2-check",
  chevron: "dsh-cmsc-v2-chevron",
  chevronOpen: "dsh-cmsc-v2-chevronOpen",
  empty: "dsh-cmsc-v2-empty",
  error: "dsh-cmsc-v2-error",
  groups: "dsh-cmsc-v2-groups",
  group: "dsh-cmsc-v2-group",
  groupHeader: "dsh-cmsc-v2-groupHeader",
  groupTitle: "dsh-cmsc-v2-groupTitle",
  groupCount: "dsh-cmsc-v2-groupCount",
  groupBody: "dsh-cmsc-v2-groupBody",
  groupBodyInner: "dsh-cmsc-v2-groupBodyInner",
  menu: "dsh-cmsc-v2-menu",
  modelName: "dsh-cmsc-v2-modelName",
  modelDescription: "dsh-cmsc-v2-modelDescription",
  modelOption: "dsh-cmsc-v2-modelOption",
  option: "dsh-cmsc-v2-option",
  optionActive: "dsh-cmsc-v2-optionActive",
  optionCopy: "dsh-cmsc-v2-optionCopy",
  retry: "dsh-cmsc-v2-retry",
  root: "dsh-cmsc-v2-root",
  search: "dsh-cmsc-v2-search",
  searchClear: "dsh-cmsc-v2-searchClear",
  searchRow: "dsh-cmsc-v2-searchRow",
  searchWithQuery: "dsh-cmsc-v2-searchWithQuery",
  selected: "dsh-cmsc-v2-selected",
  status: "dsh-cmsc-v2-status",
  trigger: "dsh-cmsc-v2-trigger",
  triggerEffort: "dsh-cmsc-v2-triggerEffort",
  triggerIcon: "dsh-cmsc-v2-triggerIcon",
  triggerLabel: "dsh-cmsc-v2-triggerLabel",
  warning: "dsh-cmsc-v2-warning"
};

// src/client/model-state.ts
function defaultExpanded(current, groups, disclosure) {
  if (disclosure === "all") return new Set(groups.map((group) => group.id));
  if (disclosure === "none") return /* @__PURE__ */ new Set();
  return current === void 0 ? /* @__PURE__ */ new Set() : /* @__PURE__ */ new Set([current.group.id]);
}
function toggled(expanded, providerId, disclosure) {
  if (disclosure === "accordion") {
    return expanded.has(providerId) ? /* @__PURE__ */ new Set() : /* @__PURE__ */ new Set([providerId]);
  }
  const next = new Set(expanded);
  if (next.has(providerId)) next.delete(providerId);
  else next.add(providerId);
  return next;
}

// src/client/provider-order.ts
function orderModelProviders(groups) {
  return [...groups].sort((left, right) => (left.id === "deepseek-account" ? 0 : left.id === "deepseek-official" ? 1 : 2) - (right.id === "deepseek-account" ? 0 : right.id === "deepseek-official" ? 1 : 2));
}

// src/client/CollapsibleModelSelect.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var MEASURE_STYLE = { visibility: "hidden", left: 0, top: 0 };
function CollapsibleModelSelect({ locked, available, directory, load, select, t, preferences }) {
  const state = (0, import_react.useSyncExternalStore)(
    (fn) => directory.subscribe(fn),
    () => directory.getSnapshot()
  );
  const preference = (0, import_react.useSyncExternalStore)(preferences.subscribe, preferences.getSnapshot).value;
  const [open, setOpen] = (0, import_react.useState)(false);
  const [pane, setPane] = (0, import_react.useState)("root");
  const [expanded, setExpanded] = (0, import_react.useState)(() => /* @__PURE__ */ new Set());
  const [query, setQuery] = (0, import_react.useState)("");
  const [highlightedIndex, setHighlightedIndex] = (0, import_react.useState)(null);
  const [selectionFocus, setSelectionFocus] = (0, import_react.useState)(false);
  const lastActionRef = (0, import_react.useRef)("load");
  const [toast, setToast] = (0, import_react.useState)(null);
  const toastSeq = (0, import_react.useRef)(0);
  const rootRef = (0, import_react.useRef)(null);
  const triggerRef = (0, import_react.useRef)(null);
  const searchRef = (0, import_react.useRef)(null);
  const menuRef = (0, import_react.useRef)(null);
  const groupsRef = (0, import_react.useRef)(null);
  const [menuPos, setMenuPos] = (0, import_react.useState)(null);
  const itemRefs = (0, import_react.useRef)([]);
  const modelRefs = (0, import_react.useRef)([]);
  const groupTouchedRef = (0, import_react.useRef)(false);
  const id = (0, import_react.useId)();
  const groups = (0, import_react.useMemo)(() => orderModelProviders(state.groups), [state.groups]);
  const choices = (0, import_react.useMemo)(() => groups.flatMap((group) => group.models.map((model) => ({
    group,
    model,
    selection: {
      provider: group.id,
      model: model.id,
      ...model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }
    }
  }))), [groups]);
  const showSearch = choices.length > 4;
  const filteredGroups = (0, import_react.useMemo)(() => groups.map((group) => ({
    ...group,
    models: (0, import_dsh_client_ui_primitives2.rankByName)(group.models, showSearch ? query.trim() : "")
  })).filter((group) => group.models.length > 0), [groups, query, showSearch]);
  const selectedIndex = state.current === null ? -1 : choices.findIndex((c) => c.selection.provider === state.current?.provider && c.selection.model === state.current.model);
  const currentChoice = choices[selectedIndex];
  const searching = showSearch && query.trim() !== "";
  const isGroupOpen = (groupId) => searching || expanded.has(groupId);
  const visibleModels = (0, import_react.useMemo)(() => filteredGroups.flatMap((group) => searching || expanded.has(group.id) ? group.models.map((model) => ({ provider: group.id, model: model.id })) : []), [filteredGroups, searching, expanded]);
  const currentVisibleIndex = visibleModels.findIndex((model) => model.provider === state.current?.provider && model.model === state.current.model);
  const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1);
  const reasoning = currentChoice?.model.reasoning;
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
  const effortLabel = reasoning === void 0 ? state.retainedEffort : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
  const effortChoices = (0, import_react.useMemo)(() => reasoning === void 0 ? [] : [
    ...reasoning.defaultEffort === void 0 ? [{ key: "provider-default", effort: void 0, label: t("effort.providerDefault") }] : [],
    ...reasoning.efforts.map((effort) => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name
    }))
  ], [reasoning, t]);
  const { pending } = state;
  const busy = pending !== null || state.status === "selecting";
  const reload = () => {
    lastActionRef.current = "load";
    load();
  };
  (0, import_react.useEffect)(() => {
    if (available) reload();
  }, [available, load]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (rootRef.current?.contains(event.target) === true) return;
      if (menuRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
    };
  }, [open]);
  (0, import_react.useLayoutEffect)(() => {
    if (!showSearch) {
      setQuery("");
      setHighlightedIndex(null);
    }
  }, [showSearch]);
  (0, import_react.useEffect)(() => {
    if (pane !== "model" || groupTouchedRef.current) return;
    setExpanded(defaultExpanded(currentChoice, groups, preference.providerDisclosure));
  }, [pane, currentChoice, groups, preference.providerDisclosure]);
  const paneFocus = (0, import_react.useRef)(null);
  const previousShowSearch = (0, import_react.useRef)(showSearch);
  (0, import_react.useEffect)(() => {
    const changedSearchMode = previousShowSearch.current !== showSearch;
    previousShowSearch.current = showSearch;
    const intent = paneFocus.current ?? (changedSearchMode && pane === "model" ? "drill" : null);
    paneFocus.current = null;
    if (!open || intent === null) return;
    if (intent === "drill") {
      if (pane === "model" && showSearch) {
        searchRef.current?.focus();
        return;
      }
      const checked = menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled]):not([hidden])');
      const target = checked?.closest('[hidden],[inert],[aria-hidden="true"]') === null ? checked : itemRefs.current.find((item) => item !== null && !item.disabled && item.closest('[hidden],[inert],[aria-hidden="true"]') === null);
      (target ?? triggerRef.current)?.focus();
      return;
    }
    const cell = itemRefs.current[intent === "effort" ? 1 : 0];
    (cell !== null && cell !== void 0 && !cell.disabled ? cell : triggerRef.current)?.focus();
  }, [open, pane, showSearch]);
  (0, import_react.useLayoutEffect)(() => {
    if (open && pane === "model" && activeModelIndex >= 0) {
      modelRefs.current[activeModelIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [open, pane, activeModelIndex, visibleModels]);
  (0, import_react.useLayoutEffect)(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect === void 0) return;
      const MARGIN = 12;
      const lw = menuRef.current?.offsetWidth ?? 0;
      const lh = menuRef.current?.offsetHeight ?? 0;
      let x = rect.right - lw;
      let y = rect.top - 8 - lh;
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
      setMenuPos({ left: x, top: y });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, pane, state, query, expanded]);
  if (!available) return null;
  const show = () => {
    setSelectionFocus(false);
    triggerRef.current?.focus();
    setQuery("");
    setHighlightedIndex(null);
    groupTouchedRef.current = false;
    setExpanded(defaultExpanded(currentChoice, groups, preference.providerDisclosure));
    if (state.current === null) paneFocus.current = "drill";
    setPane(state.current === null ? "model" : "root");
    setOpen(true);
    reload();
  };
  const changeQuery = (next) => {
    setQuery(next);
    setHighlightedIndex(0);
  };
  const close = (restoreFocus = false) => {
    setOpen(false);
    setPane("root");
    if (restoreFocus) queueMicrotask(() => {
      triggerRef.current?.focus();
    });
  };
  const closeAfterSelection = () => {
    setSelectionFocus(true);
    close(true);
  };
  const drill = (next) => {
    setQuery("");
    setHighlightedIndex(null);
    if (next === "model") {
      groupTouchedRef.current = false;
      setExpanded(defaultExpanded(currentChoice, groups, preference.providerDisclosure));
    }
    paneFocus.current = "drill";
    setPane(next);
  };
  const toggleGroup = (groupId) => {
    groupTouchedRef.current = true;
    setExpanded((previous) => toggled(previous, groupId, preference.providerDisclosure));
  };
  const back = (from) => {
    paneFocus.current = from;
    setPane("root");
  };
  const moveFocus = (offset) => {
    const items = itemRefs.current.filter((item) => item !== null && !item.disabled && item.closest('[hidden],[inert],[aria-hidden="true"]') === null);
    if (items.length === 0) return;
    const active = items.findIndex((item) => item === document.activeElement);
    const next = active === -1 ? offset > 0 ? 0 : items.length - 1 : (active + offset + items.length) % items.length;
    items[next]?.focus();
  };
  const onRootKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      if (pane !== "root" && state.current !== null) back(pane);
      else close(true);
      return;
    }
    if (!open) return;
    if (pane === "model" && showSearch && (event.target instanceof HTMLInputElement || event.target instanceof Element && event.target.getAttribute("role") === "menuitemradio") && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (!busy && visibleModels.length > 0) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setHighlightedIndex((activeModelIndex + direction + visibleModels.length) % visibleModels.length);
        searchRef.current?.focus();
      }
      return;
    }
    if (pane === "model" && showSearch && event.target instanceof HTMLInputElement && (event.key === "Enter" || event.key === "Tab" && !event.shiftKey)) {
      if (event.key === "Tab" && visibleModels.length === 0) return;
      event.preventDefault();
      const highlighted = visibleModels[activeModelIndex];
      if (!busy && highlighted !== void 0) choose(highlighted);
      return;
    }
    if (event.key === "Tab") {
      if (event.shiftKey) {
        event.preventDefault();
        if (pane !== "root" && state.current !== null) back(pane);
        else close(true);
        return;
      }
      const focused = document.activeElement;
      const rows = itemRefs.current.filter((item) => item !== null && !item.disabled && item.closest('[hidden],[inert],[aria-hidden="true"]') === null);
      if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
        event.preventDefault();
        focused.click();
        return;
      }
      if (focused !== triggerRef.current) return;
      event.preventDefault();
      if (pane === "model" && showSearch) {
        setHighlightedIndex(null);
        searchRef.current?.focus();
        return;
      }
      const checked = rows.find((item) => item.getAttribute("role") === "menuitemradio" && item.getAttribute("aria-checked") === "true");
      (checked ?? rows[0])?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  };
  const onBlur = (event) => {
    if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;
    close();
  };
  const settleSelection = (result) => {
    if (result === void 0) return;
    if (result === true || typeof result === "object" && result !== null && result.ok) {
      if (rootRef.current !== null) closeAfterSelection();
      return;
    }
    if (result === false || result === null || typeof result !== "object") {
      toastSeq.current += 1;
      setToast({ seq: toastSeq.current, text: t("error.action", {
        message: directory.getSnapshot().error ?? "Model selection did not complete"
      }) });
      return;
    }
    const { error } = result;
    toastSeq.current += 1;
    setToast({
      seq: toastSeq.current,
      text: error.code === "session/writer-held" ? t("error.sessionInUse") : t("error.action", { message: `${error.code}: ${error.message}` })
    });
  };
  const submit = (selection) => {
    lastActionRef.current = "select";
    setSelectionFocus(true);
    triggerRef.current?.focus();
    void Promise.resolve().then(() => select(selection)).then(settleSelection).catch((reason) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      toastSeq.current += 1;
      setToast({ seq: toastSeq.current, text: t("error.action", { message }) });
    });
  };
  const choose = (selection) => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      closeAfterSelection();
      return;
    }
    submit(selection);
  };
  const chooseEffort = (effort) => {
    if (state.current === null) return;
    if (effectiveEffort === effort) {
      closeAfterSelection();
      return;
    }
    const selection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === void 0 ? {} : { reasoningEffort: effort }
    };
    submit(selection);
  };
  const waiting = state.current === null && state.status === "loading";
  const modelLabel = waiting ? t("trigger.loading") : currentChoice?.model.name ?? (state.current === null ? t("trigger.fallback") : `${state.current.provider}/${state.current.model}`);
  const triggerLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} \xB7 ${effortLabel}`;
  const triggerAria = waiting ? t("trigger.loading") : state.current === null ? t("trigger.selectAria") : effortLabel === void 0 ? t("trigger.aria", { model: modelLabel }) : t("trigger.ariaEffort", { model: modelLabel, effort: effortLabel });
  itemRefs.current = [];
  modelRefs.current = [];
  let itemIndex = 0;
  let modelIndex = 0;
  const itemRef = () => {
    const at = itemIndex++;
    return (node) => {
      itemRefs.current[at] = node;
    };
  };
  const modelItemRef = (modelAt) => {
    const at = itemIndex++;
    return (node) => {
      itemRefs.current[at] = node;
      if (modelAt >= 0) modelRefs.current[modelAt] = node;
    };
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      ref: rootRef,
      className: styles.root,
      "data-density": preference.density,
      "data-motion": preference.motion,
      onKeyDown: onRootKeyDown,
      onBlur,
      onMouseDown: (event) => {
        if (event.target instanceof Element && event.target.closest("button") !== null) event.preventDefault();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            ref: triggerRef,
            type: "button",
            className: styles.trigger,
            "aria-label": triggerAria,
            "aria-haspopup": "menu",
            "aria-expanded": open,
            "aria-controls": open ? `${id}-menu` : void 0,
            title: triggerLabel,
            "aria-busy": busy,
            "data-selection-focus": selectionFocus ? "" : void 0,
            onBlur: () => {
              setSelectionFocus(false);
            },
            disabled: locked,
            onClick: () => {
              if (open) {
                close(true);
              } else {
                show();
              }
            },
            onKeyDown: (event) => {
              if (open || event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              event.stopPropagation();
              show();
              paneFocus.current = "drill";
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconDataOutlineRegular, { className: styles.triggerIcon, size: 16 }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.triggerLabel, children: modelLabel }),
              effortLabel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.triggerEffort, children: effortLabel }),
              busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "ongoing" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutlineRegular, { className: clsx_default(styles.chevron, open && styles.chevronOpen) })
            ]
          }
        ),
        open && (0, import_react_dom.createPortal)(
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            import_dsh_client_ui_primitives.MenuSurface,
            {
              ref: menuRef,
              id: `${id}-menu`,
              className: styles.menu,
              style: menuPos ?? MEASURE_STYLE,
              role: pane === "model" ? "group" : "menu",
              "aria-label": t("menu.aria"),
              "aria-busy": state.status === "loading" || busy,
              "data-density": preference.density,
              "data-motion": preference.motion,
              children: [
                pane === "root" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { ref: itemRef(), type: "button", role: "menuitem", className: styles.cell, onClick: () => {
                    drill("model");
                  }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.cellLabel, children: t("menu.model") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.cellValue, children: modelLabel }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconChevronRightOutlineRegular, { className: styles.cellChevron })
                  ] }),
                  reasoning !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { ref: itemRef(), type: "button", role: "menuitem", className: styles.cell, onClick: () => {
                    drill("effort");
                  }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.cellLabel, children: t("menu.effort") }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.cellValue, children: effortLabel }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconChevronRightOutlineRegular, { className: styles.cellChevron })
                  ] })
                ] }),
                pane === "model" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  showSearch && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: styles.searchRow, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_dsh_client_ui_primitives2.Input,
                      {
                        ref: searchRef,
                        className: clsx_default(styles.search, query !== "" && styles.searchWithQuery),
                        type: "text",
                        role: "searchbox",
                        "aria-label": t("search.placeholder"),
                        "aria-controls": `${id}-models`,
                        "aria-activedescendant": activeModelIndex < 0 ? void 0 : `${id}-model-${activeModelIndex}`,
                        placeholder: t("search.placeholder"),
                        value: query,
                        readOnly: busy,
                        onChange: (event) => {
                          changeQuery(event.target.value);
                        }
                      }
                    ),
                    query !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: styles.searchClear,
                        "aria-label": t("search.clear"),
                        disabled: busy,
                        onClick: () => {
                          changeQuery("");
                          searchRef.current?.focus();
                        },
                        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconCloseFillRegular, {})
                      }
                    )
                  ] }),
                  state.status === "loading" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: styles.status, role: "status", children: t("status.loading") }),
                  state.error !== null && lastActionRef.current === "load" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: styles.error, role: "alert", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: styles.retry, onClick: reload, children: t("retry") })
                  ] }),
                  state.failures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: styles.warning, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("warning.groupLoad", { name: failure.id === "deepseek-account" ? t("provider.account") : failure.name, message: failure.message }) }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: styles.retry, onClick: reload, children: t("retry") })
                  ] }, failure.id)),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "div",
                    {
                      ref: groupsRef,
                      id: `${id}-models`,
                      className: clsx_default(styles.groups, "scrollable"),
                      role: "menu",
                      "aria-label": t("menu.model"),
                      hidden: filteredGroups.length === 0,
                      children: filteredGroups.map((group) => {
                        const groupOpen = isGroupOpen(group.id);
                        const displayName = group.id === "deepseek-account" ? t("provider.account") : group.name;
                        const headingId = `${id}-group-${group.id}-heading`;
                        const bodyId = `${id}-group-${group.id}-models`;
                        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "presentation", className: styles.group, children: [
                          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                            "button",
                            {
                              ref: itemRef(),
                              type: "button",
                              role: "menuitem",
                              id: headingId,
                              className: styles.groupHeader,
                              "aria-label": `${displayName} ${group.models.length}`,
                              "aria-expanded": groupOpen,
                              "aria-controls": bodyId,
                              disabled: busy,
                              onClick: () => {
                                toggleGroup(group.id);
                              },
                              children: [
                                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.groupTitle, children: displayName }),
                                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.groupCount, children: group.models.length }),
                                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutlineRegular, { className: clsx_default(styles.chevron, groupOpen && styles.chevronOpen) })
                              ]
                            }
                          ),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                            "div",
                            {
                              ref: (node) => {
                                node?.toggleAttribute("inert", !groupOpen);
                              },
                              id: bodyId,
                              role: "group",
                              "aria-labelledby": headingId,
                              "aria-hidden": !groupOpen,
                              "data-expanded": groupOpen,
                              className: styles.groupBody,
                              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: styles.groupBodyInner, children: group.models.map((model) => {
                                const index = groupOpen ? modelIndex++ : -1;
                                const selected = state.current?.provider === group.id && state.current.model === model.id;
                                const descriptionId = `${bodyId}-${model.id}-description`;
                                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                                  "button",
                                  {
                                    ref: modelItemRef(index),
                                    type: "button",
                                    role: "menuitemradio",
                                    "aria-label": model.name,
                                    "aria-describedby": model.description === void 0 ? void 0 : descriptionId,
                                    "aria-checked": selected,
                                    id: index < 0 ? void 0 : `${id}-model-${index}`,
                                    tabIndex: showSearch || !groupOpen ? -1 : 0,
                                    onFocus: () => {
                                      if (index >= 0) setHighlightedIndex(index);
                                    },
                                    "data-highlighted": index >= 0 && index === activeModelIndex ? "" : void 0,
                                    className: clsx_default(
                                      styles.option,
                                      styles.modelOption,
                                      selected && styles.selected,
                                      index >= 0 && index === activeModelIndex && styles.optionActive
                                    ),
                                    onMouseMove: busy || index < 0 || index === activeModelIndex ? void 0 : () => {
                                      if (showSearch) setHighlightedIndex(index);
                                      else modelRefs.current[index]?.focus();
                                    },
                                    title: model.name,
                                    disabled: busy,
                                    onClick: () => {
                                      choose({ provider: group.id, model: model.id });
                                    },
                                    children: [
                                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: styles.optionCopy, children: [
                                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.modelName, children: model.name }),
                                        model.description === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { id: descriptionId, className: styles.modelDescription, children: model.description })
                                      ] }),
                                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.check, children: pending?.provider === group.id && pending.model === model.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "ongoing" }) : selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconCheckOutlineRegular, {}) : null })
                                    ]
                                  },
                                  model.id
                                );
                              }) })
                            }
                          )
                        ] }, group.id);
                      })
                    }
                  ),
                  state.status === "ready" && filteredGroups.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: styles.empty, role: "status", children: t(choices.length === 0 ? "empty.models" : "search.empty") })
                ] }),
                pane === "effort" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  state.error !== null && lastActionRef.current === "load" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: styles.error, role: "alert", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: styles.retry, onClick: reload, children: t("action.reload") })
                  ] }),
                  effortChoices.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: styles.empty, children: t("empty.efforts") }) : effortChoices.map((level) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                    "button",
                    {
                      ref: itemRef(),
                      type: "button",
                      role: "menuitemradio",
                      "aria-checked": effectiveEffort === level.effort,
                      className: clsx_default(styles.option, effectiveEffort === level.effort && styles.selected),
                      disabled: busy,
                      onClick: () => {
                        chooseEffort(level.effort);
                      },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.optionCopy, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.modelName, children: level.label }) }),
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: styles.check, children: pending !== null && pending.provider === state.current?.provider && pending.model === state.current.model && pending.reasoningEffort === level.effort ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "ongoing" }) : effectiveEffort === level.effort ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconCheckOutlineRegular, {}) : null })
                      ]
                    },
                    level.key
                  ))
                ] })
              ]
            }
          ),
          document.body
        ),
        toast !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives2.Toast,
          {
            text: toast.text,
            icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives2.IconWarningOutlineRegular, {}),
            anchor: rootRef.current?.closest("[data-composer-card]") ?? null,
            onDone: () => {
              setToast(null);
            }
          },
          toast.seq
        )
      ]
    }
  );
}

// src/client/ChatModelSelect.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function ChatModelSelect({ t, preferences, getDirectory, load, select }) {
  const directory = getDirectory();
  const state = (0, import_react2.useSyncExternalStore)(directory.subscribe, directory.getSnapshot);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    CollapsibleModelSelect,
    {
      available: state.available,
      locked: state.locked,
      directory,
      load,
      select,
      preferences,
      t
    }
  );
}

// src/client/SettingsSection.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react3 = require("react");

// src/client/locales.ts
var SETTINGS_LOCALE_NS = "settings.modelSelectionCollapsible";
var en = {
  nav: "Model selector",
  title: "Model selector",
  intro: "Tune how provider groups are presented without changing model configuration or calls.",
  "scope.browser": "Saved in this browser for the current DSH web address.",
  "scope.memory": "Browser storage is unavailable. Changes last until this page is refreshed or closed.",
  "disclosure.title": "Provider groups",
  "disclosure.description": "Choose which providers are expanded when you open the model list.",
  "disclosure.current": "Current provider",
  "disclosure.current.description": "Expand only the provider of the selected model.",
  "disclosure.all": "All providers",
  "disclosure.all.description": "Start with every provider expanded.",
  "disclosure.none": "All collapsed",
  "disclosure.none.description": "Start with a compact list of provider names.",
  "disclosure.accordion": "One at a time",
  "disclosure.accordion.description": "Keep at most one provider expanded.",
  "density.title": "List density",
  "density.description": "Adjust spacing in provider and model rows.",
  "density.comfortable": "Comfortable",
  "density.comfortable.description": "Roomier rows with model descriptions.",
  "density.compact": "Compact",
  "density.compact.description": "Shorter rows while keeping descriptions available to assistive technology.",
  "motion.title": "Animation",
  "motion.description": "Control provider expand and collapse motion.",
  "motion.system": "Follow system",
  "motion.system.description": "Use smooth motion unless reduced motion is enabled in the system.",
  "motion.none": "Off",
  "motion.none.description": "Apply expand and collapse changes immediately.",
  reset: "Restore defaults"
};
var zh = {
  nav: "\u6A21\u578B\u9009\u62E9\u5668",
  title: "\u6A21\u578B\u9009\u62E9\u5668",
  intro: "\u8C03\u6574\u4F9B\u5E94\u5546\u5206\u7EC4\u7684\u663E\u793A\u65B9\u5F0F\uFF0C\u4E0D\u4F1A\u6539\u53D8\u6A21\u578B\u914D\u7F6E\u6216\u8C03\u7528\u903B\u8F91\u3002",
  "scope.browser": "\u8FD9\u4E9B\u504F\u597D\u4FDD\u5B58\u5728\u5F53\u524D\u6D4F\u89C8\u5668\u4E0E DSH Web \u5730\u5740\u4E2D\u3002",
  "scope.memory": "\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF1B\u66F4\u6539\u53EA\u4FDD\u7559\u5230\u5237\u65B0\u6216\u5173\u95ED\u5F53\u524D\u9875\u9762\u3002",
  "disclosure.title": "\u4F9B\u5E94\u5546\u5206\u7EC4",
  "disclosure.description": "\u9009\u62E9\u6BCF\u6B21\u6253\u5F00\u6A21\u578B\u5217\u8868\u65F6\u9ED8\u8BA4\u5C55\u5F00\u54EA\u4E9B\u4F9B\u5E94\u5546\u3002",
  "disclosure.current": "\u5F53\u524D\u4F9B\u5E94\u5546",
  "disclosure.current.description": "\u4EC5\u5C55\u5F00\u5F53\u524D\u6240\u9009\u6A21\u578B\u7684\u4F9B\u5E94\u5546\u3002",
  "disclosure.all": "\u5168\u90E8\u5C55\u5F00",
  "disclosure.all.description": "\u6253\u5F00\u5217\u8868\u65F6\u5C55\u5F00\u6240\u6709\u4F9B\u5E94\u5546\u3002",
  "disclosure.none": "\u5168\u90E8\u6298\u53E0",
  "disclosure.none.description": "\u4EE5\u7CBE\u7B80\u7684\u4F9B\u5E94\u5546\u540D\u79F0\u5217\u8868\u5F00\u59CB\u3002",
  "disclosure.accordion": "\u5355\u7EC4\u5C55\u5F00",
  "disclosure.accordion.description": "\u540C\u4E00\u65F6\u95F4\u6700\u591A\u5C55\u5F00\u4E00\u4E2A\u4F9B\u5E94\u5546\u3002",
  "density.title": "\u5217\u8868\u5BC6\u5EA6",
  "density.description": "\u8C03\u6574\u4F9B\u5E94\u5546\u548C\u6A21\u578B\u884C\u7684\u95F4\u8DDD\u3002",
  "density.comfortable": "\u8212\u9002",
  "density.comfortable.description": "\u4F7F\u7528\u8F83\u5BBD\u677E\u7684\u884C\u8DDD\u5E76\u663E\u793A\u6A21\u578B\u8BF4\u660E\u3002",
  "density.compact": "\u7D27\u51D1",
  "density.compact.description": "\u7F29\u77ED\u884C\u9AD8\uFF0C\u540C\u65F6\u4FDD\u7559\u8F85\u52A9\u6280\u672F\u53EF\u8BFB\u53D6\u7684\u6A21\u578B\u8BF4\u660E\u3002",
  "motion.title": "\u52A8\u753B",
  "motion.description": "\u63A7\u5236\u4F9B\u5E94\u5546\u5C55\u5F00\u548C\u6298\u53E0\u7684\u52A8\u6001\u6548\u679C\u3002",
  "motion.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "motion.system.description": "\u9ED8\u8BA4\u4F7F\u7528\u5E73\u6ED1\u52A8\u753B\uFF1B\u7CFB\u7EDF\u5F00\u542F\u51CF\u5C11\u52A8\u6001\u6548\u679C\u65F6\u81EA\u52A8\u5173\u95ED\u3002",
  "motion.none": "\u5173\u95ED",
  "motion.none.description": "\u7ACB\u5373\u5B8C\u6210\u5C55\u5F00\u548C\u6298\u53E0\u3002",
  reset: "\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E"
};
var dictionaries = { zh, en };

// src/client/preferences.ts
var PREFERENCES_STORAGE_KEY = "@local/dsh-ui-model-selection-collapsible/preferences/v1";
var providerDisclosureValues = ["current", "all", "none", "accordion"];
var densityValues = ["comfortable", "compact"];
var motionValues = ["system", "none"];
var DEFAULT_PREFERENCES = Object.freeze({
  providerDisclosure: "current",
  density: "comfortable",
  motion: "system"
});
function memberOf(values, value) {
  return typeof value === "string" && values.includes(value);
}
function decodePreferences(input) {
  if (typeof input !== "object" || input === null) return { ...DEFAULT_PREFERENCES };
  const value = input;
  return {
    providerDisclosure: memberOf(providerDisclosureValues, value.providerDisclosure) ? value.providerDisclosure : DEFAULT_PREFERENCES.providerDisclosure,
    density: memberOf(densityValues, value.density) ? value.density : DEFAULT_PREFERENCES.density,
    motion: memberOf(motionValues, value.motion) ? value.motion : DEFAULT_PREFERENCES.motion
  };
}
function preferencesEqual(left, right) {
  return left.providerDisclosure === right.providerDisclosure && left.density === right.density && left.motion === right.motion;
}
function parseStored(raw) {
  if (raw === null) return { ...DEFAULT_PREFERENCES };
  try {
    return decodePreferences(JSON.parse(raw));
  } catch {
    return void 0;
  }
}
function browserStorage() {
  if (typeof window === "undefined") return void 0;
  try {
    return window.localStorage;
  } catch {
    return void 0;
  }
}
function browserWindow() {
  return typeof window === "undefined" ? void 0 : window;
}
var BrowserPreferencesStore = class {
  constructor(storage = browserStorage(), eventTarget = browserWindow()) {
    this.storage = storage;
    this.eventTarget = eventTarget;
    let value = { ...DEFAULT_PREFERENCES };
    let persistence = "memory";
    if (storage !== void 0) {
      try {
        value = parseStored(storage.getItem(PREFERENCES_STORAGE_KEY)) ?? {
          ...DEFAULT_PREFERENCES
        };
        persistence = "browser";
      } catch {
        persistence = "memory";
      }
    }
    this.snapshot = { value, persistence };
    eventTarget?.addEventListener("storage", this.onStorage);
  }
  listeners = /* @__PURE__ */ new Set();
  snapshot;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  setPreference(field, value) {
    const next = { ...this.snapshot.value, [field]: value };
    if (preferencesEqual(next, this.snapshot.value)) return;
    this.publish(next, this.persist(next));
  }
  reset() {
    let persistence = this.storage === void 0 ? "memory" : "browser";
    if (this.storage !== void 0) {
      try {
        this.storage.removeItem(PREFERENCES_STORAGE_KEY);
      } catch {
        persistence = "memory";
      }
    }
    this.publish({ ...DEFAULT_PREFERENCES }, persistence);
  }
  dispose() {
    this.eventTarget?.removeEventListener("storage", this.onStorage);
    this.listeners.clear();
  }
  onStorage = (event) => {
    if (this.storage === void 0) return;
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea !== null && event.storageArea !== this.storage) {
      return;
    }
    const next = parseStored(event.newValue);
    if (next === void 0) return;
    if (preferencesEqual(next, this.snapshot.value) && this.snapshot.persistence === "browser") {
      return;
    }
    this.publish(next, "browser");
  };
  persist(value) {
    if (this.storage === void 0) return "memory";
    try {
      this.storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(value));
      return "browser";
    } catch {
      return "memory";
    }
  }
  publish(value, persistence) {
    if (preferencesEqual(value, this.snapshot.value) && persistence === this.snapshot.persistence) {
      return;
    }
    this.snapshot = { value, persistence };
    for (const listener of this.listeners) listener();
  }
};

// src/client/styles.ts
var styles2 = {
  root: "dsh-cmsc-root",
  trigger: "dsh-cmsc-trigger",
  triggerLabel: "dsh-cmsc-triggerLabel",
  triggerEffort: "dsh-cmsc-triggerEffort",
  chevron: "dsh-cmsc-chevron",
  chevronOpen: "dsh-cmsc-chevronOpen",
  menu: "dsh-cmsc-menu",
  status: "dsh-cmsc-status",
  empty: "dsh-cmsc-empty",
  error: "dsh-cmsc-error",
  warning: "dsh-cmsc-warning",
  retry: "dsh-cmsc-retry",
  groups: "dsh-cmsc-groups",
  group: "dsh-cmsc-group",
  groupHeader: "dsh-cmsc-groupHeader",
  groupTitle: "dsh-cmsc-groupTitle",
  groupCount: "dsh-cmsc-groupCount",
  groupBody: "dsh-cmsc-groupBody",
  groupBodyInner: "dsh-cmsc-groupBodyInner",
  option: "dsh-cmsc-option",
  selected: "dsh-cmsc-selected",
  optionCopy: "dsh-cmsc-optionCopy",
  modelName: "dsh-cmsc-modelName",
  description: "dsh-cmsc-description",
  check: "dsh-cmsc-check",
  cell: "dsh-cmsc-cell",
  cellLabel: "dsh-cmsc-cellLabel",
  cellValue: "dsh-cmsc-cellValue",
  cellChevron: "dsh-cmsc-cellChevron",
  settingsSection: "dsh-cmsc-settingsSection",
  settingsHeader: "dsh-cmsc-settingsHeader",
  settingsTitle: "dsh-cmsc-settingsTitle",
  settingsIntro: "dsh-cmsc-settingsIntro",
  settingsScope: "dsh-cmsc-settingsScope",
  settingsGroup: "dsh-cmsc-settingsGroup",
  settingsLegend: "dsh-cmsc-settingsLegend",
  settingsDescription: "dsh-cmsc-settingsDescription",
  settingsChoices: "dsh-cmsc-settingsChoices",
  settingsChoice: "dsh-cmsc-settingsChoice",
  settingsRadio: "dsh-cmsc-settingsRadio",
  settingsChoiceCopy: "dsh-cmsc-settingsChoiceCopy",
  settingsChoiceTitle: "dsh-cmsc-settingsChoiceTitle",
  settingsChoiceDescription: "dsh-cmsc-settingsChoiceDescription",
  settingsChoiceCheck: "dsh-cmsc-settingsChoiceCheck",
  settingsReset: "dsh-cmsc-settingsReset"
};

// src/client/SettingsSection.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function ChoiceGroup({
  field,
  titleKey,
  descriptionKey,
  values,
  value,
  preferences,
  labelKey,
  optionDescriptionKey,
  t
}) {
  const id = (0, import_react3.useId)();
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("fieldset", { className: styles2.settingsGroup, "aria-describedby": `${id}-description`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("legend", { className: styles2.settingsLegend, children: t(titleKey) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: `${id}-description`, className: styles2.settingsDescription, children: t(descriptionKey) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: styles2.settingsChoices, children: values.map((option) => {
      const selected = value === option;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: styles2.settingsChoice, "data-selected": selected, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: styles2.settingsRadio,
            type: "radio",
            name: `${id}-${String(field)}`,
            value: String(option),
            checked: selected,
            onChange: () => preferences.setPreference(field, option)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: styles2.settingsChoiceCopy, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: styles2.settingsChoiceTitle, children: t(labelKey(option)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: styles2.settingsChoiceDescription, children: t(optionDescriptionKey(option)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: styles2.settingsChoiceCheck, "aria-hidden": "true", children: selected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconCheckOutlineRegular, {}) : null })
      ] }, String(option));
    }) })
  ] });
}
function SettingsSection({ preferences, t }) {
  const snapshot = (0, import_react3.useSyncExternalStore)(preferences.subscribe, preferences.getSnapshot);
  const value = snapshot.value;
  const isDefault = preferencesEqual(value, DEFAULT_PREFERENCES);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: styles2.settingsSection, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: styles2.settingsHeader, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: styles2.settingsTitle, children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: styles2.settingsIntro, children: t("intro") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: styles2.settingsScope, role: "status", children: t(snapshot.persistence === "browser" ? "scope.browser" : "scope.memory") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ChoiceGroup,
      {
        field: "providerDisclosure",
        titleKey: "disclosure.title",
        descriptionKey: "disclosure.description",
        values: providerDisclosureValues,
        value: value.providerDisclosure,
        preferences,
        labelKey: (option) => `disclosure.${option}`,
        optionDescriptionKey: (option) => `disclosure.${option}.description`,
        t
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ChoiceGroup,
      {
        field: "density",
        titleKey: "density.title",
        descriptionKey: "density.description",
        values: densityValues,
        value: value.density,
        preferences,
        labelKey: (option) => `density.${option}`,
        optionDescriptionKey: (option) => `density.${option}.description`,
        t
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      ChoiceGroup,
      {
        field: "motion",
        titleKey: "motion.title",
        descriptionKey: "motion.description",
        values: motionValues,
        value: value.motion,
        preferences,
        labelKey: (option) => `motion.${option}`,
        optionDescriptionKey: (option) => `motion.${option}.description`,
        t
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        type: "button",
        className: styles2.settingsReset,
        disabled: isDefault,
        onClick: () => preferences.reset(),
        children: t("reset")
      }
    )
  ] });
}

// src/client/index.tsx
var inject = ["slots", "sessions", "locale"];
function hasMethod(value, name) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  return typeof value[name] === "function";
}
function isCompatibleDirectory(value) {
  if (typeof value !== "object" || value === null) return false;
  const directory = value;
  if (!hasMethod(directory, "load") || !hasMethod(directory, "select")) return false;
  const store = directory.store;
  if (!hasMethod(store, "getSnapshot") || !hasMethod(store, "subscribe")) return false;
  const snapshot = store.getSnapshot();
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const state = snapshot;
  return Array.isArray(state.groups) && Array.isArray(state.failures) && typeof state.status === "string" && (state.current === null || typeof state.current === "object") && (state.routable === null || typeof state.routable === "boolean") && (state.pending === null || typeof state.pending === "object") && (state.error === null || typeof state.error === "string");
}
function apply(ctx) {
  const preferences = new BrowserPreferencesStore();
  ctx.effect(
    () => () => preferences.dispose(),
    "ui-model-selection-collapsible: browser preference storage"
  );
  ctx.effect(
    () => ctx.locale.register(SETTINGS_LOCALE_NS, dictionaries),
    "ui-model-selection-collapsible: settings dictionaries"
  );
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "model-selection-collapsible",
        order: 30,
        label: () => ctx.locale.bind(SETTINGS_LOCALE_NS)("nav"),
        locale: SETTINGS_LOCALE_NS,
        inject: () => ({ preferences })
      },
      SettingsSection
    )
  );
  ctx.slots.inject(
    "chat.input.model",
    () => ctx.slots.register(
      {
        name: "chat.input.model",
        locale: "model",
        inject: () => ({ preferences })
      },
      ChatModelSelect
    )
  );
  ctx.inject(["modelDirectories", "remote", "remote.session"], (scope) => {
    const models = scope.modelDirectories;
    if (typeof models?.directoryFor !== "function") return;
    const sessions = scope.sessions;
    if (typeof sessions?.subagentAddress !== "function") return;
    scope.slots.inject(
      "conversation.input.model",
      () => scope.slots.register(
        {
          name: "conversation.input.model",
          locale: "model",
          priority: -1,
          inject: (sessionId) => {
            const session = sessionId;
            const directory = models.directoryFor(session);
            if (!isCompatibleDirectory(directory)) {
              throw new Error("Incompatible DSH model directory; using the official model selector");
            }
            const available = sessions.subagentAddress(session) === void 0;
            return {
              available,
              preferences,
              directory: directory.store,
              load: () => {
                if (available) void directory.load().catch(() => void 0);
              },
              select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0)
            };
          }
        },
        CollapsibleModelSelect
      )
    );
  });
}
return module.exports; } });
//# sourceMappingURL=client.js.map
