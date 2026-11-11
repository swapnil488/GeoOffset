import { Component } from "react";

/** Keeps one broken page from blanking the whole app. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <h1>This page hit an error</h1>
        <p className="lede">{String(this.state.error.message || this.state.error)}</p>
        <p><button className="btn btn-quiet" onClick={() => location.reload()}>Reload the page</button></p>
      </div>
    );
  }
}
