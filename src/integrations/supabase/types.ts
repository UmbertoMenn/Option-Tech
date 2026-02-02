export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      deposits: {
        Row: {
          amount: number
          created_at: string
          deposit_date: string
          description: string | null
          id: string
          portfolio_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          deposit_date: string
          description?: string | null
          id?: string
          portfolio_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          deposit_date?: string
          description?: string | null
          id?: string
          portfolio_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      derivative_overrides: {
        Row: {
          bought_call_id: string | null
          bought_put_id: string | null
          created_at: string
          id: string
          linked_stock_id: string | null
          override_type: string
          portfolio_id: string
          position_id: string | null
          sold_call_id: string | null
          sold_put_id: string | null
          strategy_type: string | null
          target_category: string | null
          updated_at: string
        }
        Insert: {
          bought_call_id?: string | null
          bought_put_id?: string | null
          created_at?: string
          id?: string
          linked_stock_id?: string | null
          override_type: string
          portfolio_id: string
          position_id?: string | null
          sold_call_id?: string | null
          sold_put_id?: string | null
          strategy_type?: string | null
          target_category?: string | null
          updated_at?: string
        }
        Update: {
          bought_call_id?: string | null
          bought_put_id?: string | null
          created_at?: string
          id?: string
          linked_stock_id?: string | null
          override_type?: string
          portfolio_id?: string
          position_id?: string | null
          sold_call_id?: string | null
          sold_put_id?: string | null
          strategy_type?: string | null
          target_category?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "derivative_overrides_bought_call_id_fkey"
            columns: ["bought_call_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_bought_put_id_fkey"
            columns: ["bought_put_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_linked_stock_id_fkey"
            columns: ["linked_stock_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_sold_call_id_fkey"
            columns: ["sold_call_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derivative_overrides_sold_put_id_fkey"
            columns: ["sold_put_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      etf_allocations: {
        Row: {
          country_allocations: Json
          created_at: string
          currency_allocations: Json
          id: string
          is_hedged: boolean | null
          isin: string
          last_fetched_at: string
          name: string | null
          sector_allocations: Json | null
          top_holdings: Json | null
          updated_at: string
        }
        Insert: {
          country_allocations?: Json
          created_at?: string
          currency_allocations?: Json
          id?: string
          is_hedged?: boolean | null
          isin: string
          last_fetched_at?: string
          name?: string | null
          sector_allocations?: Json | null
          top_holdings?: Json | null
          updated_at?: string
        }
        Update: {
          country_allocations?: Json
          created_at?: string
          currency_allocations?: Json
          id?: string
          is_hedged?: boolean | null
          isin?: string
          last_fetched_at?: string
          name?: string | null
          sector_allocations?: Json | null
          top_holdings?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      historical_data: {
        Row: {
          average_balance: number
          created_at: string
          deposits: number
          id: string
          netting_ex_cc: number
          netting_ex_cc_np: number
          netting_total: number
          portfolio_id: string
          snapshot_date: string
          total_value: number
          updated_at: string
        }
        Insert: {
          average_balance?: number
          created_at?: string
          deposits?: number
          id?: string
          netting_ex_cc?: number
          netting_ex_cc_np?: number
          netting_total?: number
          portfolio_id: string
          snapshot_date: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          average_balance?: number
          created_at?: string
          deposits?: number
          id?: string
          netting_ex_cc?: number
          netting_ex_cc_np?: number
          netting_total?: number
          portfolio_id?: string
          snapshot_date?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_data_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      isin_mappings: {
        Row: {
          created_at: string
          exchange: string | null
          industry: string | null
          isin: string
          last_verified_at: string
          sector: string | null
          source: string
          ticker: string
        }
        Insert: {
          created_at?: string
          exchange?: string | null
          industry?: string | null
          isin: string
          last_verified_at?: string
          sector?: string | null
          source: string
          ticker: string
        }
        Update: {
          created_at?: string
          exchange?: string | null
          industry?: string | null
          isin?: string
          last_verified_at?: string
          sector?: string | null
          source?: string
          ticker?: string
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          average_balance: number | null
          average_balance_date: string | null
          cash_value: number | null
          created_at: string
          deposits: number | null
          id: string
          initial_date: string | null
          initial_value: number | null
          last_updated: string | null
          name: string
          snapshot_date: string | null
          total_value: number | null
          user_id: string
        }
        Insert: {
          average_balance?: number | null
          average_balance_date?: string | null
          cash_value?: number | null
          created_at?: string
          deposits?: number | null
          id?: string
          initial_date?: string | null
          initial_value?: number | null
          last_updated?: string | null
          name?: string
          snapshot_date?: string | null
          total_value?: number | null
          user_id: string
        }
        Update: {
          average_balance?: number | null
          average_balance_date?: string | null
          cash_value?: number | null
          created_at?: string
          deposits?: number | null
          id?: string
          initial_date?: string | null
          initial_value?: number | null
          last_updated?: string | null
          name?: string
          snapshot_date?: string | null
          total_value?: number | null
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          asset_type: string
          avg_cost: number | null
          created_at: string
          currency: string | null
          current_price: number | null
          description: string
          exchange_rate: number | null
          expiry_date: string | null
          id: string
          isin: string | null
          market_value: number | null
          option_type: string | null
          portfolio_id: string
          profit_loss: number | null
          profit_loss_pct: number | null
          quantity: number
          strike_price: number | null
          ticker: string | null
          underlying: string | null
          updated_at: string
          weight_pct: number | null
        }
        Insert: {
          asset_type: string
          avg_cost?: number | null
          created_at?: string
          currency?: string | null
          current_price?: number | null
          description: string
          exchange_rate?: number | null
          expiry_date?: string | null
          id?: string
          isin?: string | null
          market_value?: number | null
          option_type?: string | null
          portfolio_id: string
          profit_loss?: number | null
          profit_loss_pct?: number | null
          quantity: number
          strike_price?: number | null
          ticker?: string | null
          underlying?: string | null
          updated_at?: string
          weight_pct?: number | null
        }
        Update: {
          asset_type?: string
          avg_cost?: number | null
          created_at?: string
          currency?: string | null
          current_price?: number | null
          description?: string
          exchange_rate?: number | null
          expiry_date?: string | null
          id?: string
          isin?: string | null
          market_value?: number | null
          option_type?: string | null
          portfolio_id?: string
          profit_loss?: number | null
          profit_loss_pct?: number | null
          quantity?: number
          strike_price?: number | null
          ticker?: string | null
          underlying?: string | null
          updated_at?: string
          weight_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      price_update_logs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          positions_failed: number | null
          positions_updated: number | null
          source: string | null
          started_at: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          positions_failed?: number | null
          positions_updated?: number | null
          source?: string | null
          started_at?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          positions_failed?: number | null
          positions_updated?: number | null
          source?: string | null
          started_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      underlying_mappings: {
        Row: {
          created_at: string | null
          id: string
          source: string | null
          ticker: string
          underlying: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          source?: string | null
          ticker: string
          underlying: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          source?: string | null
          ticker?: string
          underlying?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
