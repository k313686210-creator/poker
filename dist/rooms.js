"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const roomDialog = byId("rooms");
  const roomArea = byId("room-area");
  const stateLabel = byId("room-status");
  const actions = byId("room-actions");
  const seats = byId("room-seats");
  const suits = ["", "", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  let membership;
  let state;
  let busy = false;
  let polling = false;

  function make(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  }

  function cards(values, blanks = 0) {
    const row = make("div", "cards");
    for (const card of values) {
      if (!card) {
        row.append(make("span", "card back", "♠"));
        continue;
      }
      const tile = make("span", "card face" + ("♥♦".includes(card.suit) ? " red" : ""));
      tile.append(make("b", "", suits[card.rank]), make("em", "", card.suit));
      row.append(tile);
    }
    for (let index = 0; index < blanks; index++) row.append(make("span", "card slot"));
    return row;
  }

  async function api(path, data, token) {
    const headers = {};
    if (data) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(path, { method: data ? "POST" : "GET", headers, body: data ? JSON.stringify(data) : undefined });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
    return value;
  }

  function show(value) {
    state = value;
    const { game, names, code, seat } = state;
    byId("room-caption").textContent = "房间 " + code + " · " + names.length + " / 16 人";
    byId("room-code-display").textContent = code;
    byId("room-board").replaceChildren(cards(game?.board || [], 5 - (game?.board.length || 0)));
    byId("room-pot").textContent = game ? ["翻牌前", "翻牌", "转牌", "河牌"][game.street] + " · 底池 " + game.pot : "等待开局";
    seats.replaceChildren(...names.map((name, index) => {
      const player = make("div", "room-seat" + (game?.turn === index ? " current" : ""));
      const title = name + (seat === index ? "（你）" : "") + (game?.dealer === index ? " · 庄家" : index === 0 ? " · 房主" : "");
      const status = game ? game.stacks[index] + " 筹码" + (game.folded.includes(index) ? " · 已弃牌" : game.stacks[index] === 0 && !game.done ? " · 全下" : "") : "已加入";
      player.append(make("strong", "", title), make("small", "", status));
      if (game?.cards[index].length) player.append(cards(game.cards[index]));
      return player;
    }));
    byId("room-history").replaceChildren(...(game?.history || []).map(line => make("li", "", line)));
    actions.replaceChildren();

    function button(label, act, primary = false) {
      const element = make("button", primary ? "primary" : "", label);
      element.addEventListener("click", act);
      actions.append(element);
    }
    if (!game) {
      stateLabel.textContent = names.length < 2 ? "把房间码发给朋友，至少 2 人才能开局。" : "等待房主开局。";
      if (seat === 0 && names.length >= 2) button("开始游戏", () => move("start"), true);
      return;
    }
    if (game.done) {
      stateLabel.textContent = game.result + (game.matchOver ? " · 本桌结束" : "");
      if (seat === 0 && !game.matchOver) button("下一手", () => move("next"), true);
      return;
    }
    if (!game.options) {
      stateLabel.textContent = "等待 " + names[game.turn] + " 行动";
      return;
    }
    const { call, high, min, max } = game.options;
    stateLabel.textContent = call ? "轮到你 · 需跟注 " + call : "轮到你";
    button("弃牌", () => move("fold"));
    button(call ? "跟注 " + call : "过牌", () => move("pass"), true);
    if (max > high) {
      const field = make("label", "wager", high ? "加注至" : "下注额");
      const input = make("input");
      Object.assign(input, { type: "number", min, max, value: min });
      field.append(input);
      actions.append(field);
      button(high ? "加注" : "下注", () => {
        if (input.reportValidity() && input.value) move("raise", input.valueAsNumber);
      });
      button("最大下注 " + max, () => move("raise", max));
    }
  }

  async function move(action, target) {
    if (busy) return;
    busy = true;
    const current = membership;
    try {
      const value = await api("/api/action", { code: current.code, revision: state.revision, action, target }, current.token);
      if (membership === current) show(value);
    } catch (error) {
      if (membership === current) stateLabel.textContent = error.message;
    } finally {
      busy = false;
    }
  }

  function enter(current, value) {
    membership = current;
    try { sessionStorage.setItem("river-room", JSON.stringify(current)); } catch {}
    document.querySelector(".layout").hidden = true;
    roomArea.hidden = false;
    byId("multiplayer").hidden = true;
    byId("reset").hidden = true;
    byId("mode").textContent = "多人房间 · 无限注";
    if (roomDialog.open) roomDialog.close();
    show(value);
  }

  function leave() {
    membership = null;
    state = null;
    try { sessionStorage.removeItem("river-room"); } catch {}
    roomArea.hidden = true;
    document.querySelector(".layout").hidden = false;
    byId("multiplayer").hidden = false;
    byId("reset").hidden = false;
    byId("mode").textContent = "单挑练习桌 · 无限注";
  }

  async function join(path, code) {
    if (busy) return;
    const message = byId("room-message");
    if (location.protocol === "file:") {
      message.textContent = "请先运行 start-game.cmd，再用窗口里的网址打开游戏。";
      return;
    }
    busy = true;
    message.textContent = "正在连接房间…";
    try {
      const value = await api(path, { code, name: byId("room-name").value });
      enter({ code: value.code, token: value.token }, value.state);
      message.textContent = "";
    } catch (error) {
      message.textContent = error instanceof SyntaxError ? "请用 start-game.cmd 启动多人服务器。" : error.message;
    } finally {
      busy = false;
    }
  }

  byId("multiplayer").addEventListener("click", () => roomDialog.showModal());
  byId("create-room").addEventListener("click", () => join("/api/create"));
  byId("join-room").addEventListener("submit", event => {
    event.preventDefault();
    join("/api/join", byId("room-code").value.trim().toUpperCase());
  });
  byId("leave-room").addEventListener("click", leave);
  byId("copy-room").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      byId("copy-room").textContent = "已复制";
    } catch {
      byId("copy-room").textContent = "请手动复制";
    }
  });

  async function refresh() {
    const current = membership;
    if (!current || busy || polling) return;
    polling = true;
    try {
      const value = await api("/api/state?code=" + encodeURIComponent(current.code), null, current.token);
      if (membership === current && !busy && value.revision > state.revision) show(value);
    } catch (error) {
      if (membership !== current) return;
      if ([401, 404].includes(error.status)) {
        leave();
        byId("room-message").textContent = error.message;
        roomDialog.showModal();
      } else {
        stateLabel.textContent = "连接中断，正在重试…";
      }
    } finally {
      polling = false;
    }
  }

  setInterval(refresh, 750);
  try {
    const saved = JSON.parse(sessionStorage.getItem("river-room"));
    if (saved?.code && saved?.token) {
      api("/api/state?code=" + encodeURIComponent(saved.code), null, saved.token)
        .then(value => enter(saved, value))
        .catch(() => sessionStorage.removeItem("river-room"));
    }
  } catch {}
})();
