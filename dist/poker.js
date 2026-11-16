"use strict";

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["", "", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const streets = ["翻牌前", "翻牌", "转牌", "河牌"];
const handNames = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const bigBlind = 20;

function shuffle() {
  const deck = suits.flatMap(suit => ranks.slice(2).map((_, index) => ({ rank: index + 2, suit })));
  for (let index = deck.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

function compare(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function evaluateFive(cards) {
  const sorted = cards.map(card => card.rank).sort((a, b) => b - a);
  const unique = [...new Set(sorted)];
  const counts = unique.map(rank => [sorted.filter(value => value === rank).length, rank]);
  counts.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const ordered = counts.map(group => group[1]);
  const [first, second] = counts.map(group => group[0]);
  const flush = cards.every(card => card.suit === cards[0].suit);
  let straight = 0;
  if (unique.length === 5 && sorted[0] - sorted[4] === 4) straight = sorted[0];
  if (sorted.join(",") === "14,5,4,3,2") straight = 5;
  if (straight && flush) return [8, straight];
  if (first === 4) return [7, ...ordered];
  if (first === 3 && second === 2) return [6, ...ordered];
  if (flush) return [5, ...sorted];
  if (straight) return [4, straight];
  if (first === 3) return [3, ...ordered];
  if (first === 2 && second === 2) return [2, ...ordered];
  if (first === 2) return [1, ...ordered];
  return [0, ...sorted];
}

function bestHand(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a++) {
    for (let b = a + 1; b < cards.length - 3; b++) {
      for (let c = b + 1; c < cards.length - 2; c++) {
        for (let d = c + 1; d < cards.length - 1; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            const score = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compare(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best;
}

class Table {
  constructor() {
    this.stacks = [1000, 1000];
    this.number = 0;
    this.history = [];
    this.start();
  }

  start() {
    if (this.stacks.includes(0)) return;
    this.number++;
    this.dealer = (this.number - 1) % 2;
    this.deck = shuffle();
    this.hole = [[this.deck.pop(), this.deck.pop()], [this.deck.pop(), this.deck.pop()]];
    this.board = [];
    this.street = 0;
    this.pot = 0;
    this.bets = [0, 0];
    this.minRaise = bigBlind;
    this.done = false;
    this.reveal = false;
    this.turn = this.dealer;
    this.pending = new Set([0, 1]);
    const effective = Math.min(...this.stacks);
    this.pay(this.dealer, Math.min(10, effective));
    this.pay(1 - this.dealer, Math.min(bigBlind, effective));
    this.log("第 " + this.number + " 手 · 发底牌");
    this.advance(this.dealer);
  }

  log(message) {
    this.history.unshift(message);
    this.history.length = Math.min(this.history.length, 45);
  }

  pay(player, amount) {
    this.stacks[player] -= amount;
    this.bets[player] += amount;
    this.pot += amount;
  }

  options(player) {
    const high = Math.max(...this.bets);
    const max = Math.min(...this.bets.map((bet, index) => bet + this.stacks[index]));
    return { call: high - this.bets[player], high, max, min: Math.min(max, high + this.minRaise) };
  }

  act(player, action, target) {
    if (this.done || this.turn !== player) return false;
    const other = 1 - player;
    const name = player === 0 ? "你" : "电脑";
    const { call, high, min, max } = this.options(player);
    this.lastError = "";
    if (action === "fold") {
      this.log(name + "弃牌");
      this.finish(other);
      return true;
    }
    if (action === "raise") {
      if (max <= high || !Number.isInteger(target) || target < min || target > max) {
        this.lastError = "请输入 " + min + " 至 " + max + " 之间的整数。";
        return false;
      }
      this.pay(player, target - this.bets[player]);
      this.minRaise = Math.max(this.minRaise, target - high);
      this.pending = new Set([other]);
      this.log(name + (high ? "加注至 " : "下注 ") + target);
    } else {
      this.pay(player, call);
      this.pending.delete(player);
      this.log(name + (call ? "跟注 " + call : "过牌"));
    }
    this.advance(other);
    return true;
  }

  advance(next) {
    if (this.bets[0] === this.bets[1] && this.stacks.includes(0)) {
      while (this.board.length < 5) this.dealStreet();
      this.showdown();
      return;
    }
    if (this.pending.size) {
      this.turn = this.pending.has(next) ? next : 1 - next;
      return;
    }
    if (this.street === 3) {
      this.showdown();
      return;
    }
    this.dealStreet();
    this.bets = [0, 0];
    this.minRaise = bigBlind;
    this.pending = new Set([0, 1]);
    this.turn = 1 - this.dealer;
  }

  dealStreet() {
    this.street++;
    this.deck.pop();
    const count = this.street === 1 ? 3 : 1;
    for (let index = 0; index < count; index++) this.board.push(this.deck.pop());
    this.log(streets[this.street]);
  }

  showdown() {
    this.reveal = true;
    const hands = this.hole.map(cards => bestHand([...cards, ...this.board]));
    const result = compare(...hands);
    const names = hands.map(hand => hand[0] === 8 && hand[1] === 14 ? "皇家同花顺" : handNames[hand[0]]);
    this.finish(result > 0 ? 0 : result < 0 ? 1 : null, "你：" + names[0] + " · 电脑：" + names[1]);
  }

  finish(winner, detail) {
    this.done = true;
    const uncalled = Math.abs(this.bets[0] - this.bets[1]);
    if (uncalled) {
      const bettor = this.bets[0] > this.bets[1] ? 0 : 1;
      this.stacks[bettor] += uncalled;
      this.pot -= uncalled;
    }
    if (winner === null) {
      this.stacks[0] += this.pot / 2;
      this.stacks[1] += this.pot / 2;
      this.result = "平局，各得 " + this.pot / 2;
    } else {
      this.stacks[winner] += this.pot;
      this.result = (winner === 0 ? "你" : "电脑") + "赢得 " + this.pot + " 筹码";
    }
    if (detail) this.result += " · " + detail;
    this.log(this.result);
  }

  computer() {
    const { call, high, min, max } = this.options(1);
    const [left, right] = this.hole[1];
    const preflop = left.rank === right.rank ? .8 : (left.rank + right.rank - 4) / 31 + (left.suit === right.suit ? .12 : 0);
    const score = this.board.length ? bestHand([...this.hole[1], ...this.board]) : null;
    const strength = score ? Math.min(.97, .17 + score[0] * .19 + score[1] / 75) : preflop;
    const aggression = strength + (Math.random() - .5) * .46;
    if (call && aggression + .08 < call / (this.pot + call)) return this.act(1, "fold");
    if (max > high && aggression > .66 && Math.random() < .55) {
      const target = Math.min(max, Math.max(min, high + Math.floor(this.pot * .45)));
      return this.act(1, "raise", target);
    }
    return this.act(1, "pass");
  }
}

function boot() {
  const byId = id => document.getElementById(id);
  let table = new Table();
  let timer;

  function cardMarkup(card, hidden = false) {
    if (hidden) return '<span class="card back" aria-label="盖着的底牌">♠</span>';
    if (!card) return '<span class="card slot" aria-hidden="true"></span>';
    const red = card.suit === "♥" || card.suit === "♦";
    return '<span class="card face' + (red ? ' red' : '') + '" aria-label="' + ranks[card.rank] + card.suit + '"><b>' + ranks[card.rank] + '</b><em>' + card.suit + '</em></span>';
  }

  function render() {
    clearTimeout(timer);
    byId("hero-cards").innerHTML = table.hole[0].map(card => cardMarkup(card)).join("");
    byId("cpu-cards").innerHTML = table.hole[1].map(card => cardMarkup(card, !table.reveal)).join("");
    byId("board").innerHTML = Array.from({ length: 5 }, (_, index) => cardMarkup(table.board[index])).join("");
    ["hero", "cpu"].forEach((seat, index) => {
      byId(seat + "-stack").textContent = table.stacks[index].toLocaleString("zh-CN") + " 筹码";
      byId(seat + "-dealer").innerHTML = table.dealer === index ? '<span class="dealer" title="庄家">D</span>' : "";
    });
    byId("stage").textContent = table.done ? "本手结束" : streets[table.street];
    byId("pot").textContent = "底池 " + table.pot;
    byId("hand-number").textContent = "第 " + table.number + " 手";
    byId("history").replaceChildren(...table.history.map(line => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }));

    const actions = byId("actions");
    const status = byId("status");
    actions.replaceChildren();
    function addButton(label, handler, primary = false) {
      const button = document.createElement("button");
      button.textContent = label;
      if (primary) button.className = "primary";
      button.addEventListener("click", handler);
      actions.append(button);
    }
    if (table.done) {
      status.textContent = table.result;
      if (table.stacks.includes(0)) {
        addButton("重新开桌", reset, true);
      } else {
        addButton("下一手", () => { table.start(); render(); }, true);
      }
      return;
    }
    if (table.turn === 1) {
      status.textContent = "电脑正在行动…";
      timer = setTimeout(() => { table.computer(); render(); }, 580);
      return;
    }

    const { call, high, min, max } = table.options(0);
    status.textContent = call ? "轮到你 · 需跟注 " + call : "轮到你";
    function play(action, target) {
      if (table.act(0, action, target)) render();
      else status.textContent = table.lastError;
    }
    addButton("弃牌", () => play("fold"));
    addButton(call ? "跟注 " + call : "过牌", () => play("pass"), true);
    if (max > high) {
      const label = document.createElement("label");
      label.className = "wager";
      label.textContent = high ? "加注至" : "下注额";
      const input = document.createElement("input");
      input.type = "number";
      input.min = min;
      input.max = max;
      input.value = min;
      label.append(input);
      actions.append(label);
      addButton(high ? "加注" : "下注", () => play("raise", input.valueAsNumber));
      addButton("有效全下 " + max, () => play("raise", max));
    }
  }

  function reset() {
    table = new Table();
    render();
  }

  byId("rules").addEventListener("click", () => byId("help").showModal());
  byId("reset").addEventListener("click", reset);
  render();
}

if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { bestHand, compare, handNames, streets, suits, ranks, bigBlind };
