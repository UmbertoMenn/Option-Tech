import React from "react";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  children: React.ReactNode;
  title?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep this console error: it helps us debug black-screen reports.
    console.error("[ErrorBoundary] UI crashed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="border-border bg-card">
          <CardContent className="py-10">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {this.props.title ?? "Si è verificato un errore nella schermata."}
              </p>
              <p className="text-xs text-muted-foreground break-words">
                {this.state.error.message}
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
