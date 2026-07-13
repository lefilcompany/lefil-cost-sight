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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_id: string | null
          created_at: string
          id: string
          message: string | null
          metadata: Json | null
          metric_value: number | null
          organization_id: string
          owner_user_id: string | null
          resolved_at: string | null
          scope: string | null
          scope_id: string | null
          scope_label: string | null
          severity: string
          status: string
          threshold: number | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          metric_value?: number | null
          organization_id?: string
          owner_user_id?: string | null
          resolved_at?: string | null
          scope?: string | null
          scope_id?: string | null
          scope_label?: string | null
          severity?: string
          status?: string
          threshold?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          metric_value?: number | null
          organization_id?: string
          owner_user_id?: string | null
          resolved_at?: string | null
          scope?: string | null
          scope_id?: string | null
          scope_label?: string | null
          severity?: string
          status?: string
          threshold?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "cost_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          new_values: Json | null
          occurred_at: string
          old_values: Json | null
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_cost_records: {
        Row: {
          cloud_project_id: string | null
          created_at: string
          credit_amount: number
          currency: string
          external_row_hash: string
          gross_cost: number
          id: string
          imported_at: string
          invoice_month: string | null
          net_cost: number
          organization_id: string
          provider_connection_id: string
          raw_metadata: Json
          service_description: string | null
          service_id: string | null
          sku_description: string | null
          sku_id: string | null
          source: string
          updated_at: string
          usage_date: string
          usage_end_time: string | null
          usage_start_time: string | null
        }
        Insert: {
          cloud_project_id?: string | null
          created_at?: string
          credit_amount?: number
          currency?: string
          external_row_hash: string
          gross_cost?: number
          id?: string
          imported_at?: string
          invoice_month?: string | null
          net_cost?: number
          organization_id: string
          provider_connection_id: string
          raw_metadata?: Json
          service_description?: string | null
          service_id?: string | null
          sku_description?: string | null
          sku_id?: string | null
          source?: string
          updated_at?: string
          usage_date: string
          usage_end_time?: string | null
          usage_start_time?: string | null
        }
        Update: {
          cloud_project_id?: string | null
          created_at?: string
          credit_amount?: number
          currency?: string
          external_row_hash?: string
          gross_cost?: number
          id?: string
          imported_at?: string
          invoice_month?: string | null
          net_cost?: number
          organization_id?: string
          provider_connection_id?: string
          raw_metadata?: Json
          service_description?: string | null
          service_id?: string | null
          sku_description?: string | null
          sku_id?: string | null
          source?: string
          updated_at?: string
          usage_date?: string
          usage_end_time?: string | null
          usage_start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_cost_records_cloud_project_id_fkey"
            columns: ["cloud_project_id"]
            isOneToOne: false
            referencedRelation: "cloud_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_cost_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_cost_records_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          cnpj: string | null
          company: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          owner_user_id: string | null
          responsible: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          company?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id?: string
          owner_user_id?: string | null
          responsible?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          company?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          owner_user_id?: string | null
          responsible?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_projects: {
        Row: {
          billing_account_id: string | null
          billing_enabled: boolean | null
          created_at: string
          external_project_id: string
          external_project_number: string | null
          id: string
          metadata: Json
          name: string | null
          organization_id: string
          provider_connection_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          billing_account_id?: string | null
          billing_enabled?: boolean | null
          created_at?: string
          external_project_id: string
          external_project_number?: string | null
          id?: string
          metadata?: Json
          name?: string | null
          organization_id: string
          provider_connection_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          billing_account_id?: string | null
          billing_enabled?: boolean | null
          created_at?: string
          external_project_id?: string
          external_project_number?: string | null
          id?: string
          metadata?: Json
          name?: string | null
          organization_id?: string
          provider_connection_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_projects_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_alerts: {
        Row: {
          channel: string
          comparison: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_evaluated_at: string | null
          metric: string
          name: string
          organization_id: string
          owner_user_id: string | null
          scope: string
          scope_id: string | null
          threshold: number
          updated_at: string
        }
        Insert: {
          channel?: string
          comparison?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_evaluated_at?: string | null
          metric: string
          name: string
          organization_id?: string
          owner_user_id?: string | null
          scope: string
          scope_id?: string | null
          threshold: number
          updated_at?: string
        }
        Update: {
          channel?: string
          comparison?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_evaluated_at?: string | null
          metric?: string
          name?: string
          organization_id?: string
          owner_user_id?: string | null
          scope?: string
          scope_id?: string | null
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_entries: {
        Row: {
          client_id: string | null
          cost_brl: number | null
          cost_usd: number
          created_at: string
          description: string | null
          entry_date: string
          exchange_rate: number | null
          id: string
          metadata: Json | null
          organization_id: string
          origin: string
          owner_user_id: string | null
          platform_id: string | null
          provider_id: string | null
          raw_response: Json | null
          updated_at: string
          usage_quantity: number | null
          usage_unit: string | null
        }
        Insert: {
          client_id?: string | null
          cost_brl?: number | null
          cost_usd?: number
          created_at?: string
          description?: string | null
          entry_date?: string
          exchange_rate?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          origin?: string
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id?: string | null
          raw_response?: Json | null
          updated_at?: string
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Update: {
          client_id?: string | null
          cost_brl?: number | null
          cost_usd?: number
          created_at?: string
          description?: string | null
          entry_date?: string
          exchange_rate?: number | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          origin?: string
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id?: string | null
          raw_response?: Json | null
          updated_at?: string
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_entries_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_entries_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_reconciliations: {
        Row: {
          cloud_project_id: string | null
          confirmed_cost: number | null
          created_at: string
          difference_amount: number | null
          difference_percentage: number | null
          estimated_cost: number | null
          explanation: string | null
          id: string
          model: string | null
          organization_id: string
          reconciled_at: string | null
          reconciliation_date: string
          sku_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cloud_project_id?: string | null
          confirmed_cost?: number | null
          created_at?: string
          difference_amount?: number | null
          difference_percentage?: number | null
          estimated_cost?: number | null
          explanation?: string | null
          id?: string
          model?: string | null
          organization_id: string
          reconciled_at?: string | null
          reconciliation_date: string
          sku_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cloud_project_id?: string | null
          confirmed_cost?: number | null
          created_at?: string
          difference_amount?: number | null
          difference_percentage?: number | null
          estimated_cost?: number | null
          explanation?: string | null
          id?: string
          model?: string | null
          organization_id?: string
          reconciled_at?: string | null
          reconciliation_date?: string
          sku_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_reconciliations_cloud_project_id_fkey"
            columns: ["cloud_project_id"]
            isOneToOne: false
            referencedRelation: "cloud_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_notes: {
        Row: {
          author_id: string | null
          body: string | null
          created_at: string
          id: string
          organization_id: string
          owner_user_id: string | null
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          owner_user_id?: string | null
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          owner_user_id?: string | null
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_usage_events: {
        Row: {
          cached_tokens: number | null
          cloud_project_id: string | null
          created_at: string
          currency: string
          duration_ms: number | null
          environment: string | null
          estimated_cost: number | null
          http_status: number | null
          id: string
          model: string
          occurred_at: string
          operation: string | null
          organization_id: string
          output_tokens: number | null
          pricing_status: string
          prompt_tokens: number | null
          provider_connection_id: string | null
          request_id: string | null
          success: boolean | null
          tags: Json
          thinking_tokens: number | null
          total_tokens: number | null
        }
        Insert: {
          cached_tokens?: number | null
          cloud_project_id?: string | null
          created_at?: string
          currency?: string
          duration_ms?: number | null
          environment?: string | null
          estimated_cost?: number | null
          http_status?: number | null
          id?: string
          model: string
          occurred_at: string
          operation?: string | null
          organization_id: string
          output_tokens?: number | null
          pricing_status?: string
          prompt_tokens?: number | null
          provider_connection_id?: string | null
          request_id?: string | null
          success?: boolean | null
          tags?: Json
          thinking_tokens?: number | null
          total_tokens?: number | null
        }
        Update: {
          cached_tokens?: number | null
          cloud_project_id?: string | null
          created_at?: string
          currency?: string
          duration_ms?: number | null
          environment?: string | null
          estimated_cost?: number | null
          http_status?: number | null
          id?: string
          model?: string
          occurred_at?: string
          operation?: string | null
          organization_id?: string
          output_tokens?: number | null
          pricing_status?: string
          prompt_tokens?: number | null
          provider_connection_id?: string | null
          request_id?: string | null
          success?: boolean | null
          tags?: Json
          thinking_tokens?: number | null
          total_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gemini_usage_events_cloud_project_id_fkey"
            columns: ["cloud_project_id"]
            isOneToOne: false
            referencedRelation: "cloud_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gemini_usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gemini_usage_events_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      google_billing_connections: {
        Row: {
          bigquery_dataset_id: string
          bigquery_project_id: string
          billing_account_id: string
          billing_enabled: boolean | null
          billing_mode: string | null
          created_at: string
          currency: string
          dataset_location: string
          detailed_billing_table: string | null
          gemini_project_id: string
          gemini_project_number: string | null
          gemini_tier: string | null
          id: string
          manual_balance_checked_at: string | null
          manual_prepaid_balance: number | null
          manual_spend_cap: number | null
          notes: string | null
          organization_id: string
          pricing_table: string | null
          provider_connection_id: string
          standard_billing_table: string
          timezone: string
          updated_at: string
        }
        Insert: {
          bigquery_dataset_id: string
          bigquery_project_id: string
          billing_account_id: string
          billing_enabled?: boolean | null
          billing_mode?: string | null
          created_at?: string
          currency?: string
          dataset_location?: string
          detailed_billing_table?: string | null
          gemini_project_id: string
          gemini_project_number?: string | null
          gemini_tier?: string | null
          id?: string
          manual_balance_checked_at?: string | null
          manual_prepaid_balance?: number | null
          manual_spend_cap?: number | null
          notes?: string | null
          organization_id: string
          pricing_table?: string | null
          provider_connection_id: string
          standard_billing_table: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          bigquery_dataset_id?: string
          bigquery_project_id?: string
          billing_account_id?: string
          billing_enabled?: boolean | null
          billing_mode?: string | null
          created_at?: string
          currency?: string
          dataset_location?: string
          detailed_billing_table?: string | null
          gemini_project_id?: string
          gemini_project_number?: string | null
          gemini_tier?: string | null
          id?: string
          manual_balance_checked_at?: string | null
          manual_prepaid_balance?: number | null
          manual_spend_cap?: number | null
          notes?: string | null
          organization_id?: string
          pricing_table?: string | null
          provider_connection_id?: string
          standard_billing_table?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_billing_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_billing_connections_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: true
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          permissions: string[]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          permissions?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          permissions?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          country: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          document: string | null
          id: string
          legal_name: string | null
          name: string
          segment: string | null
          slug: string
          status: string
          team_size: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          document?: string | null
          id?: string
          legal_name?: string | null
          name: string
          segment?: string | null
          slug: string
          status?: string
          team_size?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          document?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          segment?: string | null
          slug?: string
          status?: string
          team_size?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_presets: {
        Row: {
          category: string | null
          color: string | null
          created_at: string
          default_alert_monthly_brl: number | null
          default_alert_variance_pct: number | null
          default_provider_id: string | null
          description: string | null
          environment: string | null
          icon: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string
          default_alert_monthly_brl?: number | null
          default_alert_variance_pct?: number | null
          default_provider_id?: string | null
          description?: string | null
          environment?: string | null
          icon?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string
          default_alert_monthly_brl?: number | null
          default_alert_variance_pct?: number | null
          default_provider_id?: string | null
          description?: string | null
          environment?: string | null
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_presets_default_provider_id_fkey"
            columns: ["default_provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      platforms: {
        Row: {
          card_last4: string | null
          color: string
          created_at: string
          description: string | null
          environment: string
          icon: string
          id: string
          image_url: string | null
          name: string
          organization_id: string
          owner_contact_id: string | null
          owner_user_id: string | null
          payment_method: string | null
          status: string
          summary: string | null
          updated_at: string
        }
        Insert: {
          card_last4?: string | null
          color?: string
          created_at?: string
          description?: string | null
          environment?: string
          icon?: string
          id?: string
          image_url?: string | null
          name: string
          organization_id?: string
          owner_contact_id?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Update: {
          card_last4?: string | null
          color?: string
          created_at?: string
          description?: string | null
          environment?: string
          icon?: string
          id?: string
          image_url?: string | null
          name?: string
          organization_id?: string
          owner_contact_id?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          status?: string
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platforms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platforms_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_skus: {
        Row: {
          created_at: string
          currency: string
          effective_from: string | null
          effective_to: string | null
          id: string
          model_name: string | null
          provider_connection_id: string | null
          raw_metadata: Json
          service_id: string | null
          service_name: string | null
          sku_id: string
          sku_name: string | null
          source: string
          status: string
          unit: string | null
          unit_price: number | null
          updated_at: string
          usage_type: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          model_name?: string | null
          provider_connection_id?: string | null
          raw_metadata?: Json
          service_id?: string | null
          service_name?: string | null
          sku_id: string
          sku_name?: string | null
          source?: string
          status?: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          usage_type?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          model_name?: string | null
          provider_connection_id?: string | null
          raw_metadata?: Json
          service_id?: string | null
          service_name?: string | null
          sku_id?: string
          sku_name?: string | null
          source?: string
          status?: string
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          usage_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_skus_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_billing_snapshots: {
        Row: {
          billing_cycle: string | null
          captured_at: string
          connection_id: string
          cost_period_usd: number | null
          created_at: string
          currency: string
          cycle_end: string | null
          cycle_start: string | null
          hard_limit_usd: number | null
          id: string
          included_quantity: number | null
          included_unit: string | null
          organization_id: string
          owner_user_id: string | null
          plan_name: string | null
          plan_tier: string | null
          platform_id: string | null
          projected_cost_usd: number | null
          provider_id: string
          raw: Json | null
          remaining_quantity: number | null
          soft_limit_usd: number | null
          used_quantity: number | null
        }
        Insert: {
          billing_cycle?: string | null
          captured_at?: string
          connection_id: string
          cost_period_usd?: number | null
          created_at?: string
          currency?: string
          cycle_end?: string | null
          cycle_start?: string | null
          hard_limit_usd?: number | null
          id?: string
          included_quantity?: number | null
          included_unit?: string | null
          organization_id?: string
          owner_user_id?: string | null
          plan_name?: string | null
          plan_tier?: string | null
          platform_id?: string | null
          projected_cost_usd?: number | null
          provider_id: string
          raw?: Json | null
          remaining_quantity?: number | null
          soft_limit_usd?: number | null
          used_quantity?: number | null
        }
        Update: {
          billing_cycle?: string | null
          captured_at?: string
          connection_id?: string
          cost_period_usd?: number | null
          created_at?: string
          currency?: string
          cycle_end?: string | null
          cycle_start?: string | null
          hard_limit_usd?: number | null
          id?: string
          included_quantity?: number | null
          included_unit?: string | null
          organization_id?: string
          owner_user_id?: string | null
          plan_name?: string | null
          plan_tier?: string | null
          platform_id?: string | null
          projected_cost_usd?: number | null
          provider_id?: string
          raw?: Json | null
          remaining_quantity?: number | null
          soft_limit_usd?: number | null
          used_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_billing_snapshots_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_billing_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_billing_snapshots_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_billing_snapshots_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_connections: {
        Row: {
          api_key_secret_id: string | null
          config: Json | null
          created_at: string
          id: string
          last_sync_at: string | null
          name: string
          organization_id: string
          owner_user_id: string | null
          platform_id: string | null
          provider_id: string
          secret_ref: string | null
          status: string
          updated_at: string
        }
        Insert: {
          api_key_secret_id?: string | null
          config?: Json | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          name: string
          organization_id?: string
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id: string
          secret_ref?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          api_key_secret_id?: string | null
          config?: Json | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          name?: string
          organization_id?: string
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id?: string
          secret_ref?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_connections_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_connections_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_invoices: {
        Row: {
          amount_brl: number
          amount_usd: number
          connection_id: string | null
          created_at: string
          exchange_rate: number
          id: string
          invoice_number: string | null
          issued_at: string | null
          notes: string | null
          organization_id: string
          owner_user_id: string | null
          pdf_url: string | null
          period_end: string | null
          period_start: string | null
          platform_id: string | null
          provider_id: string
          raw: Json | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_brl?: number
          amount_usd?: number
          connection_id?: string | null
          created_at?: string
          exchange_rate?: number
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_id?: string | null
          provider_id: string
          raw?: Json | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_brl?: number
          amount_usd?: number
          connection_id?: string | null
          created_at?: string
          exchange_rate?: number
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          notes?: string | null
          organization_id?: string
          owner_user_id?: string | null
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_id?: string | null
          provider_id?: string
          raw?: Json | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_invoices_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_invoices_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_invoices_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_service_mappings: {
        Row: {
          active: boolean
          created_at: string
          external_service_id: string | null
          external_service_name: string | null
          external_sku_id: string | null
          external_sku_name: string | null
          id: string
          internal_category: string
          model_name: string | null
          organization_id: string | null
          provider: string
          reviewed_by: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          external_service_id?: string | null
          external_service_name?: string | null
          external_sku_id?: string | null
          external_sku_name?: string | null
          id?: string
          internal_category?: string
          model_name?: string | null
          organization_id?: string | null
          provider: string
          reviewed_by?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          external_service_id?: string | null
          external_service_name?: string | null
          external_sku_id?: string | null
          external_sku_name?: string | null
          id?: string
          internal_category?: string
          model_name?: string | null
          organization_id?: string | null
          provider?: string
          reviewed_by?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_service_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_daily: {
        Row: {
          connection_id: string
          cost_brl: number
          cost_usd: number
          created_at: string
          endpoint: string
          exchange_rate: number
          id: string
          input_tokens: number
          model: string
          organization_id: string
          output_tokens: number
          owner_user_id: string | null
          platform_id: string | null
          provider_id: string
          quantity: number
          raw: Json | null
          requests: number
          synced_at: string
          unit: string | null
          usage_date: string
        }
        Insert: {
          connection_id: string
          cost_brl?: number
          cost_usd?: number
          created_at?: string
          endpoint?: string
          exchange_rate?: number
          id?: string
          input_tokens?: number
          model?: string
          organization_id?: string
          output_tokens?: number
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id: string
          quantity?: number
          raw?: Json | null
          requests?: number
          synced_at?: string
          unit?: string | null
          usage_date: string
        }
        Update: {
          connection_id?: string
          cost_brl?: number
          cost_usd?: number
          created_at?: string
          endpoint?: string
          exchange_rate?: number
          id?: string
          input_tokens?: number
          model?: string
          organization_id?: string
          output_tokens?: number
          owner_user_id?: string | null
          platform_id?: string | null
          provider_id?: string
          quantity?: number
          raw?: Json | null
          requests?: number
          synced_at?: string
          unit?: string | null
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_daily_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_daily_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_daily_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_syncs: {
        Row: {
          client_id: string | null
          cost_brl: number | null
          cost_usd: number
          created_at: string
          exchange_rate: number | null
          id: string
          organization_id: string
          owner_user_id: string | null
          period_end: string | null
          period_start: string | null
          platform_id: string | null
          provider_id: string
          raw_response: Json | null
          usage_quantity: number | null
          usage_unit: string | null
        }
        Insert: {
          client_id?: string | null
          cost_brl?: number | null
          cost_usd?: number
          created_at?: string
          exchange_rate?: number | null
          id?: string
          organization_id?: string
          owner_user_id?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_id?: string | null
          provider_id: string
          raw_response?: Json | null
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Update: {
          client_id?: string | null
          cost_brl?: number | null
          cost_usd?: number
          created_at?: string
          exchange_rate?: number | null
          id?: string
          organization_id?: string
          owner_user_id?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_id?: string | null
          provider_id?: string
          raw_response?: Json | null
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_usage_syncs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_syncs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_syncs_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_usage_syncs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          owner_user_id: string | null
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id?: string
          owner_user_id?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          owner_user_id?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "providers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_filters: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          organization_id: string
          page: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          page: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          page?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_filters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          created_at: string
          error_code: string | null
          error_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          metadata: Json
          organization_id: string
          period_end: string | null
          period_start: string | null
          provider_connection_id: string | null
          records_inserted: number
          records_read: number
          records_skipped: number
          records_updated: number
          started_at: string | null
          status: string
          sync_type: string
          trigger_type: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          provider_connection_id?: string | null
          records_inserted?: number
          records_read?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string | null
          status?: string
          sync_type: string
          trigger_type?: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          metadata?: Json
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          provider_connection_id?: string | null
          records_inserted?: number
          records_read?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string | null
          status?: string
          sync_type?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          connection_id: string | null
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json | null
          organization_id: string
          owner_user_id: string | null
          provider_id: string | null
          records_imported: number | null
          started_at: string
          status: string
        }
        Insert: {
          connection_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          owner_user_id?: string | null
          provider_id?: string | null
          records_imported?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          connection_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          owner_user_id?: string | null
          provider_id?: string | null
          records_imported?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_logs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
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
      approve_user: { Args: { _user_id: string }; Returns: undefined }
      block_user: { Args: { _user_id: string }; Returns: undefined }
      clear_connection_api_key: {
        Args: { _connection_id: string }
        Returns: undefined
      }
      current_org_role: {
        Args: { _org: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      default_org_id: { Args: never; Returns: string }
      get_connection_api_key: {
        Args: { _connection_id: string }
        Returns: string
      }
      get_connection_api_key_internal: {
        Args: { _connection_id: string }
        Returns: string
      }
      has_active_access: { Args: { _user_id: string }; Returns: boolean }
      has_org_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["org_role"][]
          _user?: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_authenticated: { Args: never; Returns: boolean }
      is_org_member: {
        Args: { _org: string; _user?: string }
        Returns: boolean
      }
      run_evaluate_alerts_job: {
        Args: { _apikey: string; _url: string }
        Returns: number
      }
      run_sync_billing_job: {
        Args: { _apikey: string; _url: string }
        Returns: number
      }
      set_connection_api_key: {
        Args: { _api_key: string; _connection_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "viewer"
      org_role: "owner" | "administrator" | "finance" | "analyst" | "viewer"
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
      app_role: ["admin", "viewer"],
      org_role: ["owner", "administrator", "finance", "analyst", "viewer"],
    },
  },
} as const
