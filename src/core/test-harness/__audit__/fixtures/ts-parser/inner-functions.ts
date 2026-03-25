// Fixture: inner function declarations (edge case #16)
export function outerFunction() {
  function innerHelper() {
    return 42;
  }

  function anotherInner() {
    return innerHelper();
  }

  return anotherInner();
}
