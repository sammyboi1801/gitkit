import "@vscode/codicons/dist/codicon.css";
import { mount } from "svelte";
import "../pulse/pulse.css";
import Studio from "./Studio.svelte";
import "./studio.css";

mount(Studio, { target: document.getElementById("app")! });
