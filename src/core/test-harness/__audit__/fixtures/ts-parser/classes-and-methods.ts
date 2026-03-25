// Fixture: classes with methods, constructors, interfaces
export interface Greeter {
  greet(): string;
}

export class SimpleGreeter implements Greeter {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return this.formatGreeting();
  }

  private formatGreeting(): string {
    return `Hello, ${this.name}`;
  }
}

export type GreetResult = {
  message: string;
  timestamp: number;
};
