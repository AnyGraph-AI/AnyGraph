// Fixture: super() calls (edge case #14)
export class BaseService {
  constructor(public name: string) {}

  greet(): string {
    return `Hello from ${this.name}`;
  }
}

export class ChildService extends BaseService {
  constructor(name: string, public age: number) {
    super(name);
  }

  greet(): string {
    return `${super.greet()} age ${this.age}`;
  }
}
