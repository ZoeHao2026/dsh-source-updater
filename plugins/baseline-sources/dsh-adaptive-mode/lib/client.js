window.__ModuleLoader__.load({ id: "@local/dsh-adaptive-mode", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var css = `
.dsh-adaptive-max { position: relative; display: inline-flex; align-items: center; flex: none; }
.dsh-adaptive-max__button {
  min-height: 28px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-secondary, #62666d);
  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary, #b7bcc5);
  font-family: inherit; font-size: 12px; font-weight: 600; line-height: 20px;
  cursor: pointer; white-space: nowrap;
}
.dsh-adaptive-max__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, #333840); }
.dsh-adaptive-max__button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary, #fff); border-color: #5489ff;
  background: color-mix(in srgb, #5489ff 22%, transparent);
}
.dsh-adaptive-max__button:focus-visible { outline: 2px solid #5489ff; outline-offset: 2px; }
.dsh-adaptive-max__button:disabled { cursor: not-allowed; opacity: .65; }
.dsh-adaptive-max__button[aria-busy="true"] { cursor: progress; }
.dsh-adaptive-max__notice {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20;
  width: max-content; max-width: min(340px, 75vw); padding: 8px 10px;
  border: 1px solid #5489ff; border-radius: 8px;
  background: #1d345b; color: #fff; font: 12px/1.4 sans-serif;
  white-space: normal; box-shadow: 0 4px 16px #0004;
}
.dsh-adaptive-max__error {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20;
  width: max-content; max-width: min(320px, 75vw); padding: 8px 10px;
  border-radius: 8px; background: #822c2c; color: #fff; font: 12px/1.4 sans-serif;
  white-space: normal; box-shadow: 0 4px 16px #0004;
}
.dsh-adaptive-max--plan-status .dsh-adaptive-max__error { bottom: calc(100% + 70px); }
`;
function AdaptiveMaxButton({ sessionId, useSessions, execute }) {
  const preset = useSessions((state) => state.byId[sessionId]?.projectionValues?.agentPreset);
  const active = useSessions(
    (state) => state.byId[sessionId]?.projectionValues?.adaptiveMax?.active === true
  );
  const planActive = useSessions((state) => {
    const plan = state.byId[sessionId]?.projectionValues?.plan;
    return plan?.pending === true ? plan.active !== true : plan?.active === true;
  });
  const goalActive = useSessions(
    (state) => state.byId[sessionId]?.projectionValues?.goal?.goal?.phase === "active"
  );
  const suspended = planActive || goalActive;
  const dpiraPlanActive = planActive && active && !goalActive;
  const [pending, setPending] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const zh = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh");
  (0, import_react.useEffect)(() => {
    setPending(null);
    setError(null);
  }, [sessionId]);
  (0, import_react.useEffect)(() => {
    if (pending?.complete && active === pending.target) {
      setPending(null);
      setError(null);
    }
  }, [active, pending]);
  (0, import_react.useEffect)(() => {
    if (!pending?.complete) return;
    const timer = window.setTimeout(() => {
      setPending(null);
      setError(zh ? "Max \u72B6\u6001\u5C1A\u672A\u540C\u6B65\uFF0C\u8BF7\u91CD\u8BD5\u3002" : "Max state did not sync. Try again.");
    }, 8e3);
    return () => window.clearTimeout(timer);
  }, [pending, zh]);
  if (preset !== "adaptive") return null;
  const planNotice = zh ? "Max \u8BA1\u5212\uFF08DPIRA\uFF09\u5DF2\u542F\u7528\uFF1BMax \u4FDD\u6301\u5F00\u542F\uFF0C\u8BA1\u5212\u671F\u95F4\u6682\u4E0D\u53EF\u5207\u6362\u3002" : "Max Plan (DPIRA) is active. Max remains on and cannot be switched during planning.";
  const label = dpiraPlanActive ? zh ? "Max \u8BA1\u5212\uFF08DPIRA\uFF09\u5DF2\u542F\u7528\uFF1BMax \u4FDD\u6301\u5F00\u542F\uFF0C\u8BA1\u5212\u671F\u95F4\u6682\u4E0D\u53EF\u5207\u6362" : "Max Plan (DPIRA) is active. Max remains on and cannot be switched during planning" : suspended ? zh ? `Max \u5DF2\u6682\u505C\uFF0C\u5F53\u524D\u9075\u5FAA${planActive ? " Plan \u6A21\u5F0F" : ""}${planActive && goalActive ? "\u4E0E" : ""}${goalActive ? "\u76EE\u6807\u6A21\u5F0F" : ""}\uFF1B\u539F\u5F00\u5173\u72B6\u6001\u5DF2\u4FDD\u7559` : `Max is paused while following ${planActive ? "Plan mode" : ""}${planActive && goalActive ? " and " : ""}${goalActive ? "Goal mode" : ""}; its switch state is preserved` : zh ? active ? "Max \u5DF2\u542F\u7528\uFF0C\u70B9\u51FB\u5173\u95ED DPIRA \u6D41\u7A0B" : "\u70B9\u51FB\u542F\u7528 Max \u4E0E DPIRA \u6D41\u7A0B" : active ? "Max is on. Turn off the DPIRA workflow" : "Turn on Max and the DPIRA workflow";
  async function toggle() {
    if (pending !== null || suspended) return;
    const target = !active;
    setError(null);
    setPending({ target, complete: false });
    try {
      const result = await execute(sessionId, target ? "/adaptive-max on" : "/adaptive-max off", []);
      if (!result.ok) throw new Error(result.error.message ?? result.error.code ?? "Command failed");
      if (result.value === void 0) throw new Error("Adaptive Max command is unavailable");
      if (result.value.result?.kind !== "success") {
        throw new Error(result.value.result?.text ?? "Adaptive Max command failed");
      }
      setPending((current) => current?.target === target ? { target, complete: true } : current);
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: `dsh-adaptive-max${dpiraPlanActive ? " dsh-adaptive-max--plan-status" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "dsh-adaptive-max__button",
        "aria-label": label,
        "aria-pressed": active,
        "aria-busy": pending !== null,
        title: label,
        disabled: pending !== null || suspended,
        onClick: () => {
          void toggle();
        },
        children: "Max"
      }
    ),
    dpiraPlanActive ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { role: "status", className: "dsh-adaptive-max__notice", children: planNotice }) : null,
    error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { role: "alert", className: "dsh-adaptive-max__error", children: error })
  ] });
}
var inject = ["slots", "remote", "remote.commands"];
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@local/dsh-adaptive-mode";
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, "adaptive-max: button styles");
  ctx.slots.inject(
    "conversation.input.right",
    () => ctx.slots.register(
      {
        name: "conversation.input.right",
        id: "adaptive-max",
        order: 10,
        inject: () => ({ execute: ctx.remote.commands.execute.bind(ctx.remote.commands) })
      },
      AdaptiveMaxButton
    )
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
