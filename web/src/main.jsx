import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Component } from "react";
import "./index.css";
import App from "./App.jsx";
function CrashScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="border-2 border-black bg-white p-8 max-w-md text-center">
        <h1 className="font-display font-bold text-2xl mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-muted-foreground mb-5">
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="border-2 border-black bg-[#024BAB] text-white px-5 py-2 text-sm font-bold uppercase"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
