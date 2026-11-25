// 最小示例：订阅 chat.overlay 拿会话状态，在右下角画一个角标；设置里可以改前缀。
// 这段代码在宿主里以 function (host) { … } 的形式执行，return 的函数在停用时调用。
const { React, h } = host;

function Badge({ driver, working, awaiting, embedded }) {
  host.useLang();
  const prefix = host.storage.use("prefix", "agent");
  if (embedded) return null; // side chat 里的聊天视图不重复显示
  const status = awaiting
    ? (awaiting === "approval" ? host.t("等待审批", "Awaiting approval") : host.t("等待回答", "Awaiting answer"))
    : (working ? host.t("运行中", "Running") : host.t("空闲", "Idle"));
  return h("div", { className: "t3x-hello-badge" }, `${prefix}: ${driver ?? "?"} · ${status}`);
}

function Settings() {
  host.useLang();
  const prefix = host.storage.use("prefix", "agent");
  return h("input", { className: "t3x-input", value: prefix, onChange: (e) => host.storage.set("prefix", e.target.value) });
}

host.register("chat.overlay", Badge);
host.settings(Settings);
