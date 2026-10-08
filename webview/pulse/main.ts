import "@vscode/codicons/dist/codicon.css";
import { mount } from "svelte";
import App from "./App.svelte";
import "./pulse.css";

mount(App, { target: document.getElementById("app")! });
