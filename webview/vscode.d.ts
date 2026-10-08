declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare module "*.css";
