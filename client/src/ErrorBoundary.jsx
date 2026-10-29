import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("A rendering error was caught.", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="render-error" role="alert">
          <p>{this.props.message || "This part of the app could not be displayed."}</p>
          <button className="button button-primary" onClick={() => window.location.reload()} type="button">
            Reload
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
