import { type Component, Text } from "@mariozechner/pi-tui";

export class StatusBar implements Component {
  readonly #text = new Text("", 0, 0);
  #visible = false;

  setText(value: string): void {
    const normalizedValue = value.trim();
    this.#visible = normalizedValue.length > 0;
    this.#text.setText(normalizedValue);
  }

  invalidate(): void {
    this.#text.invalidate();
  }

  render(width: number): string[] {
    if (!this.#visible) {
      return [];
    }
    return this.#text.render(width);
  }
}
