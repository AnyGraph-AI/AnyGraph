// Fixture: conditional calls (edge case #11)
export function riskyFunction(flag: boolean) {
  if (flag) {
    doSomething();
  }

  switch (flag) {
    case true:
      handleTrue();
      break;
    default:
      handleFalse();
      break;
  }

  const result = flag ? getPositive() : getNegative();

  try {
    attempt();
  } catch (e) {
    recover();
  }

  flag && shortCircuit();

  // Unconditional call
  alwaysRun();

  return result;
}

function doSomething() { return 1; }
function handleTrue() { return 2; }
function handleFalse() { return 3; }
function getPositive() { return 4; }
function getNegative() { return 5; }
function attempt() { return 6; }
function recover() { return 7; }
function shortCircuit() { return 8; }
function alwaysRun() { return 9; }
