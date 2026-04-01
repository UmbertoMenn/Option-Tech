import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { Send, Copy, Check, RefreshCw, Unlink, Clock } from 'lucide-react';

export function NotificationSettings() {
  const {
    settings,
    loading,
    updating,
    linkCode,
    generatingCode,
    updateSetting,
    generateLinkCode,
    unlinkTelegram,
    refreshSettings,
    isTelegramLinked,
  } = useNotificationSettings();

  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  // Calculate time remaining for link code
  useEffect(() => {
    if (!linkCode?.expires_at) {
      setTimeLeft(null);
      return;
    }

    const updateTimeLeft = () => {
      const now = new Date().getTime();
      const expires = new Date(linkCode.expires_at).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [linkCode]);

  const copyCode = async () => {
    if (!linkCode?.code) return;
    
    await navigator.clipboard.writeText(linkCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preferenze Notifiche</CardTitle>
          <CardDescription>Gestisci come ricevere gli avvisi del portfolio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Preferenze Notifiche</CardTitle>
          <CardDescription>Gestisci come ricevere gli avvisi del portfolio</CardDescription>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={refreshSettings}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Telegram Notifications */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Send className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Label htmlFor="notify-telegram" className="font-medium">
                Notifiche Telegram
              </Label>
              <p className="text-sm text-muted-foreground">
                Ricevi avvisi istantanei su Telegram
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isTelegramLinked && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                Collegato ✓
              </Badge>
            )}
            <Switch
              id="notify-telegram"
              checked={settings.notify_telegram}
              onCheckedChange={(value) => updateSetting('notify_telegram', value)}
              disabled={updating || !isTelegramLinked}
            />
          </div>
        </div>

        {/* Telegram Linking Section */}
        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium mb-3">Collegamento Telegram</h4>
          
          {isTelegramLinked ? (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span className="text-sm">Account Telegram collegato</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={unlinkTelegram}
                disabled={updating}
              >
                <Unlink className="h-4 w-4 mr-2" />
                Scollega
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Per ricevere notifiche su Telegram, genera un codice e invialo al nostro bot.
              </p>
              
              {linkCode && timeLeft ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                    <code className="flex-1 text-lg font-mono font-bold tracking-wider">
                      {linkCode.code}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyCode}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Scade tra {timeLeft}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Cerca <strong>@optionalertrobot</strong> su Telegram</li>
                      <li>Avvia la chat con <code>/start</code></li>
                      <li>Invia il codice: <code>{linkCode.code}</code></li>
                    </ol>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={generateLinkCode}
                  disabled={generatingCode}
                  className="w-full"
                >
                  {generatingCode ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generazione...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Genera codice di collegamento
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
