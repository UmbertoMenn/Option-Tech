import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Mail, MessageCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function AdminNotificationSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [adminNotifyEmail, setAdminNotifyEmail] = useState(true);
  const [adminNotifyTelegram, setAdminNotifyTelegram] = useState(true);

  useEffect(() => {
    if (user) loadSettings();
  }, [user]);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('admin_notify_email, admin_notify_telegram')
        .eq('user_id', user!.id)
        .single();

      if (error) throw error;
      if (data) {
        setAdminNotifyEmail(data.admin_notify_email ?? true);
        setAdminNotifyTelegram(data.admin_notify_telegram ?? true);
      }
    } catch (error) {
      console.error('Error loading admin notification settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateSetting(field: 'admin_notify_email' | 'admin_notify_telegram', value: boolean) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('user_id', user!.id);

      if (error) throw error;

      if (field === 'admin_notify_email') setAdminNotifyEmail(value);
      else setAdminNotifyTelegram(value);

      toast.success('Impostazione aggiornata');
    } catch (error) {
      console.error('Error updating setting:', error);
      toast.error('Errore aggiornamento impostazione');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle>Notifiche Admin</CardTitle>
        <CardDescription>
          Controlla la ricezione delle copie delle notifiche generate dai portafogli degli utenti.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-muted-foreground" />
            <Label htmlFor="admin-email" className="cursor-pointer">
              Email utenti
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                Ricevi via email le copie degli avvisi degli utenti
              </p>
            </Label>
          </div>
          <Switch
            id="admin-email"
            checked={adminNotifyEmail}
            onCheckedChange={(val) => updateSetting('admin_notify_email', val)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
            <Label htmlFor="admin-telegram" className="cursor-pointer">
              Telegram utenti
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                Ricevi via Telegram le copie degli avvisi degli utenti
              </p>
            </Label>
          </div>
          <Switch
            id="admin-telegram"
            checked={adminNotifyTelegram}
            onCheckedChange={(val) => updateSetting('admin_notify_telegram', val)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
