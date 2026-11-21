// Intentional bug for the demo agent: increment subtracts instead of adding.
let value = 0;

const countEl = document.getElementById("count");
const incBtn = document.getElementById("inc");
const decBtn = document.getElementById("dec");
const resetBtn = document.getElementById("reset");

function render() {
  countEl.textContent = String(value);
}

incBtn.addEventListener("click", () => {
  value -= 1; // BUG: should be += 1
  render();
});

decBtn.addEventListener("click", () => {
  value -= 1;
  render();
});

resetBtn.addEventListener("click", () => {
  value = 0;
  render();
});

render();
