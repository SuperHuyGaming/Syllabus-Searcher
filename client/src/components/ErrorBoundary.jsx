import { Component } from 'react';
import { Alert } from '@mui/material';

// Catches a crash in one part of the page (like the PDF viewer) and shows a message
// there, instead of React unmounting the whole app and leaving a blank page.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return <Alert severity="error">{this.props.message}: {this.state.error.message}</Alert>;
    }
    return this.props.children;
  }
}
