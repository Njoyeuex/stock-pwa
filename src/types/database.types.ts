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
      account_lockouts: {
        Row: {
          email: string
          failed_count: number
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          failed_count?: number
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          failed_count?: number
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_table: string
          id: string
          new_data: Json | null
          old_data: Json | null
          org_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          org_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      caisse_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_declared_cash: number | null
          expected_cash: number | null
          id: string
          opened_at: string
          opened_by: string
          opening_float: number
          org_id: string
          status: string
          store_id: string
          variance: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_declared_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by: string
          opening_float: number
          org_id: string
          status?: string
          store_id: string
          variance?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_declared_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by?: string
          opening_float?: number
          org_id?: string
          status?: string
          store_id?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "caisse_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caisse_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          caisse_session_id: string
          created_at: string
          created_by: string
          id: string
          reason: string | null
          type: string
        }
        Insert: {
          amount: number
          caisse_session_id: string
          created_at?: string
          created_by: string
          id?: string
          reason?: string | null
          type: string
        }
        Update: {
          amount?: number
          caisse_session_id?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_caisse_session_id_fkey"
            columns: ["caisse_session_id"]
            isOneToOne: false
            referencedRelation: "caisse_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_credit_balances: {
        Row: {
          balance: number
          customer_id: string
        }
        Insert: {
          balance?: number
          customer_id: string
        }
        Update: {
          balance?: number
          customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_balances_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_credit_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          customer_id: string
          id: string
          note: string | null
          org_id: string
          reference_id: string | null
          reference_table: string | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          note?: string | null
          org_id: string
          reference_id?: string | null
          reference_table?: string | null
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          note?: string | null
          org_id?: string
          reference_id?: string | null
          reference_table?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_movements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          org_id: string
          perm_caisse: boolean
          perm_catalog: boolean
          perm_invoices: boolean
          perm_users: boolean
          perm_view_reports: boolean
          perm_view_users: boolean
          role: Database["public"]["Enums"]["app_role"]
          store_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
          perm_caisse?: boolean
          perm_catalog?: boolean
          perm_invoices?: boolean
          perm_users?: boolean
          perm_view_reports?: boolean
          perm_view_users?: boolean
          role: Database["public"]["Enums"]["app_role"]
          store_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
          perm_caisse?: boolean
          perm_catalog?: boolean
          perm_invoices?: boolean
          perm_users?: boolean
          perm_view_reports?: boolean
          perm_view_users?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          store_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          sale_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: string
          sale_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          parent_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_costs: {
        Row: {
          cost_price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          cost_price?: number
          product_id: string
          updated_at?: string
        }
        Update: {
          cost_price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_stock: {
        Row: {
          product_id: string
          quantity: number
          store_id: string
        }
        Insert: {
          product_id: string
          quantity?: number
          store_id: string
        }
        Update: {
          product_id?: string
          quantity?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          created_at: string
          id: string
          image_path: string | null
          is_active: boolean
          name: string
          org_id: string
          reorder_threshold: number
          sale_price: number
          sku: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          name: string
          org_id: string
          reorder_threshold?: number
          sale_price?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          name?: string
          org_id?: string
          reorder_threshold?: number
          sale_price?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      purchase_lines: {
        Row: {
          id: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit_cost: number
        }
        Insert: {
          id?: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit_cost: number
        }
        Update: {
          id?: string
          line_total?: number
          product_id?: string
          purchase_id?: string
          quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          caisse_session_id: string | null
          created_at: string
          created_by: string
          credit_amount: number
          due_date: string | null
          id: string
          org_id: string
          paid_amount: number
          payment_source: string
          status: string
          store_id: string
          supplier_id: string | null
          total_amount: number
        }
        Insert: {
          caisse_session_id?: string | null
          created_at?: string
          created_by: string
          credit_amount?: number
          due_date?: string | null
          id?: string
          org_id: string
          paid_amount?: number
          payment_source?: string
          status?: string
          store_id: string
          supplier_id?: string | null
          total_amount?: number
        }
        Update: {
          caisse_session_id?: string | null
          created_at?: string
          created_by?: string
          credit_amount?: number
          due_date?: string | null
          id?: string
          org_id?: string
          paid_amount?: number
          payment_source?: string
          status?: string
          store_id?: string
          supplier_id?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_caisse_session_id_fkey"
            columns: ["caisse_session_id"]
            isOneToOne: false
            referencedRelation: "caisse_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_lines: {
        Row: {
          id: string
          line_total: number
          product_id: string | null
          quantity: number
          sale_id: string
          service_id: string | null
          unit_price: number
        }
        Insert: {
          id?: string
          line_total: number
          product_id?: string | null
          quantity: number
          sale_id: string
          service_id?: string | null
          unit_price: number
        }
        Update: {
          id?: string
          line_total?: number
          product_id?: string | null
          quantity?: number
          sale_id?: string
          service_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          caisse_session_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          customer_name: string | null
          id: string
          org_id: string
          sale_number: number
          status: string
          store_id: string
          total_amount: number
          voided_by: string | null
        }
        Insert: {
          caisse_session_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          org_id: string
          sale_number: number
          status?: string
          store_id: string
          total_amount?: number
          voided_by?: string | null
        }
        Update: {
          caisse_session_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          org_id?: string
          sale_number?: number
          status?: string
          store_id?: string
          total_amount?: number
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_caisse_session_id_fkey"
            columns: ["caisse_session_id"]
            isOneToOne: false
            referencedRelation: "caisse_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          price: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          price?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          movement_type: string
          note: string | null
          org_id: string
          product_id: string
          quantity: number
          reference_id: string | null
          reference_table: string | null
          store_id: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          movement_type: string
          note?: string | null
          org_id: string
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_table?: string | null
          store_id: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          movement_type?: string
          note?: string | null
          org_id?: string
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_table?: string | null
          store_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          type: Database["public"]["Enums"]["store_type"]
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          type?: Database["public"]["Enums"]["store_type"]
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          type?: Database["public"]["Enums"]["store_type"]
        }
        Relationships: [
          {
            foreignKeyName: "stores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_credit_balances: {
        Row: {
          balance: number
          supplier_id: string
        }
        Insert: {
          balance?: number
          supplier_id: string
        }
        Update: {
          balance?: number
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_credit_balances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_credit_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          due_date: string | null
          id: string
          note: string | null
          org_id: string
          reference_id: string | null
          reference_table: string | null
          supplier_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          due_date?: string | null
          id?: string
          note?: string | null
          org_id: string
          reference_id?: string | null
          reference_table?: string | null
          supplier_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          due_date?: string | null
          id?: string
          note?: string | null
          org_id?: string
          reference_id?: string | null
          reference_table?: string | null
          supplier_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_credit_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credit_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          nif: string | null
          org_id: string
          phone: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          nif?: string | null
          org_id: string
          phone?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          nif?: string | null
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      low_stock_products: {
        Row: {
          name: string | null
          org_id: string | null
          product_id: string | null
          quantity: number | null
          reorder_threshold: number | null
          store_id: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      adjust_stock: {
        Args: {
          p_note?: string
          p_org_id: string
          p_product_id: string
          p_quantity_delta: number
          p_store_id: string
        }
        Returns: string
      }
      bootstrap_organization: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      close_caisse_session: {
        Args: { p_closing_declared_cash: number; p_session_id: string }
        Returns: undefined
      }
      create_sale: {
        Args: {
          p_caisse_session_id?: string
          p_customer_id?: string
          p_customer_name?: string
          p_lines: Json
          p_org_id: string
          p_payment_method?: string
          p_store_id: string
        }
        Returns: string
      }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      get_my_role: {
        Args: { p_org_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_permission: {
        Args: { p_org_id: string; p_permission: string }
        Returns: boolean
      }
      has_store_access: {
        Args: { p_org_id: string; p_store_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      open_caisse_session: {
        Args: { p_opening_float: number; p_org_id: string; p_store_id: string }
        Returns: string
      }
      receive_purchase: {
        Args: {
          p_caisse_session_id?: string
          p_credit_amount?: number
          p_due_date?: string
          p_lines: Json
          p_org_id: string
          p_paid_source?: string
          p_store_id: string
          p_supplier_id: string
        }
        Returns: string
      }
      record_cash_movement: {
        Args: {
          p_amount: number
          p_reason?: string
          p_session_id: string
          p_type: string
        }
        Returns: string
      }
      record_customer_repayment: {
        Args: { p_amount: number; p_customer_id: string; p_note?: string }
        Returns: string
      }
      record_supplier_repayment: {
        Args: {
          p_amount: number
          p_caisse_session_id?: string
          p_from_caisse?: boolean
          p_note?: string
          p_supplier_id: string
        }
        Returns: string
      }
      restore_backup: { Args: { p_payload: Json }; Returns: undefined }
      void_sale: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "proprietaire"
        | "gerant"
        | "caissier"
        | "vendeur"
        | "magasinier"
      store_type: "boutique" | "depot"
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
      app_role: ["proprietaire", "gerant", "caissier", "vendeur", "magasinier"],
      store_type: ["boutique", "depot"],
    },
  },
} as const
