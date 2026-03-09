import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, MessageCircle, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface UserPref {
  user_id: string;
  email: string;
  full_name: string | null;
  telegram_chat_id: string | null;
  notify_email: boolean;
  notify_telegram: boolean;
}

export function AdminNotificationSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [adminNotifyEmail, setAdminNotifyEmail] = useState(true);
  const [adminNotifyTelegram, setAdminNotifyTelegram] = useState(true);
  const [userPrefs, setUserPrefs] = useState<UserPref[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (user) {
      loadSettings();
      loadUserPrefs();
    }
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

  async function loadUserPrefs() {
    setLoadingUsers(true);
    try {
      // Load profiles for all non-admin users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, telegram_chat_id')
        .neq('user_id', user!.id)
        .order('email');

      if (profilesError) throw profilesError;

      // Load admin preferences from new table
      const { data: prefs, error: prefsError } = await supabase
        .from('admin_notification_preferences')
        .select('target_user_id, notify_email, notify_telegram')
        .eq('admin_user_id', user!.id);

      if (prefsError) throw prefsError;

      const prefsMap = new Map(
        (prefs || []).map((p) => [p.target_user_id, p])
      );

      setUserPrefs(
        (profiles || []).map((p) => {
          const pref = prefsMap.get(p.user_id);
          return {
            user_id: p.user_id,
            email: p.email,
            full_name: p.full_name,
            telegram_chat_id: p.telegram_chat_id,
            notify_email: pref ? pref.notify_email : true,
            notify_telegram: pref ? pref.notify_telegram : true,
          };
        })
      );
    } catch (error) {
      console.error('Error loading user prefs:', error);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function updateSetting(field: 'admin_notify_email' | 'admin_notify_telegram', value: boolean) {
    try {
      // 1. Update admin's own toggle
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('user_id', user!.id);

      if (error) throw error;

      if (field === 'admin_notify_email') setAdminNotifyEmail(value);
      else setAdminNotifyTelegram(value);

      // 2. Propagate to all user overrides
      const prefField = field === 'admin_notify_email' ? 'notify_email' : 'notify_telegram';
      
      if (userPrefs.length > 0) {
        const rows = userPrefs.map((u) => ({
          admin_user_id: user!.id,
          target_user_id: u.user_id,
          notify_email: prefField === 'notify_email' ? value : u.notify_email,
          notify_telegram: prefField === 'notify_telegram' ? value : u.notify_telegram,
        }));

        const { error: upsertError } = await supabase
          .from('admin_notification_preferences')
          .upsert(rows, { onConflict: 'admin_user_id,target_user_id' });

        if (upsertError) throw upsertError;

        // Update local state
        setUserPrefs((prev) =>
          prev.map((p) => ({ ...p, [prefField]: value }))
        );
      }

      toast.success('Impostazione admin aggiornata');
    } catch (error) {
      console.error('Error updating setting:', error);
      toast.error('Errore aggiornamento impostazione');
    }
  }

  async function updateUserSetting(
    targetUserId: string,
    field: 'notify_email' | 'notify_telegram',
    value: boolean
  ) {
    try {
      const existing = userPrefs.find((p) => p.user_id === targetUserId);
      if (!existing) return;

      const { error } = await supabase
        .from('admin_notification_preferences')
        .upsert(
          {
            admin_user_id: user!.id,
            target_user_id: targetUserId,
            notify_email: field === 'notify_email' ? value : existing.notify_email,
            notify_telegram: field === 'notify_telegram' ? value : existing.notify_telegram,
          },
          { onConflict: 'admin_user_id,target_user_id' }
        );

      if (error) throw error;

      setUserPrefs((prev) =>
        prev.map((p) => (p.user_id === targetUserId ? { ...p, [field]: value } : p))
      );

      toast.success('Preferenza notifica aggiornata');
    } catch (error) {
      console.error('Error updating user setting:', error);
      toast.error('Errore aggiornamento preferenza');
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
    <div className="space-y-6">
      {/* Admin own notification settings */}
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

      {/* Per-user notification settings */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Notifiche per Utente</CardTitle>
          </div>
          <CardDescription>
            Attiva o disattiva la ricezione delle copie per singolo utente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : userPrefs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nessun utente trovato</p>
          ) : (
            <div className="space-y-4">
              {userPrefs.map((pref) => (
                <div
                  key={pref.user_id}
                  className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {pref.full_name || pref.email}
                    </p>
                    {pref.full_name && (
                      <p className="text-xs text-muted-foreground truncate">{pref.email}</p>
                    )}
                    {pref.telegram_chat_id && (
                      <Badge variant="outline" className="mt-1 text-xs">
                        <MessageCircle className="w-3 h-3 mr-1" />
                        Telegram ✓
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <Switch
                        checked={pref.notify_email}
                        onCheckedChange={(val) =>
                          updateUserSetting(pref.user_id, 'notify_email', val)
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4 text-muted-foreground" />
                      <Switch
                        checked={pref.notify_telegram}
                        disabled={!pref.telegram_chat_id}
                        onCheckedChange={(val) =>
                          updateUserSetting(pref.user_id, 'notify_telegram', val)
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
