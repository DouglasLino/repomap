import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var command = _a.command;
    return ({
        base: command === "build" ? "/repomap/" : "/",
        plugins: [react()],
        server: {
            port: 8080
        }
    });
});
