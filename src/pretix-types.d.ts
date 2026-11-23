/**
 * Pretix specific type definitions
 * @author Michael Townsend <@continuities>
 * @since 2026-11-22
 */

type MultilingualString = Record<string, string>;
type DatetimeString = string;
type DateString = string;
type Paginated<T> = { next: string | null; results: T[] };
interface PretixOrganiser {
  name: string;
  slug: string;
  public_url: string;
  plugins: string[];
}
interface PretixEvent {
  name: MultilingualString;
  slug: string;
  live: boolean;
  testmode: boolean;
  currency: string;
  date_from: DatetimeString;
  date_to: DatetimeString | null;
  date_admission: DatetimeString | null;
  is_public: boolean;
  presale_start: DatetimeString | null;
  presale_end: DatetimeString | null;
  location: MultilingualString | null;
  geo_lat: number | null;
  geo_lon: number | null;
  has_subevents: boolean;
  meta_data: object;
  seating_plan: number | null;
  seat_category_mapping: object;
  timezone: string;
  item_meta_properties: object;
  plugins: string[];
  all_sales_channels: boolean;
  limit_sales_channels: string[];
  sales_channels: string[];
  public_url: string;
}

interface PretixCustomer {
  identifier: string;
  external_identifier: string | null;
  email: string;
  phone: string;
  name: string;
  name_parts: Record<string, string>;
  is_active: boolean;
  is_verified: boolean;
  last_login: DatetimeString | null;
  date_joined: DatetimeString;
  locale: string;
  last_modified: DatetimeString;
  notes: string | null;
}

interface PretixCheckin {
  id: number;
  list: number;
  type: string;
  gate: number | null;
  device: number;
  device_id: number;
  datetime: DatetimeString;
  auto_checked_in: boolean;
}

interface PretixPrintlog {
  id: number;
  type: string;
  successful: boolean;
  datetime: DatetimeString;
  device_id: number;
  source: string;
  info: object;
}

interface PretixAnswer {
  datafield: string;
  question: number;
  question_identifier: string;
  answer: string;
  option_identifiers: string[];
  options: number[];
}

interface PretixSeat {
  id: number;
  name: string;
  zone_name: string;
  row_name: string;
  row_label: string;
  seat_number: string;
  seat_label: string;
  seat_guid: string;
}

interface PretixDownload {
  output: string;
  url: string;
}

interface PretixOrderPosition {
  id: number;
  order: string;
  positionid: number;
  canceled: boolean;
  item: number;
  variation: number | null;
  price: string;
  attendee_name: string;
  attendee_name_parts: Record<string, string>;
  attendee_email: string | null;
  voucher: number | null;
  voucher_budget_use: string | null;
  tax_rate: string;
  tax_rule: number | null;
  tax_value: string | null;
  tax_code: string | null;
  secret: string;
  discount: number | null;
  pseudonymization_id: string;
  seat: PretixSeat | null;
  addon_to: number | null;
  subevent: number | null;
  valid_from: DatetimeString | null;
  valid_until: DatetimeString | null;
  blocked: string[] | null;
  checkins: PretixCheckin[];
  print_logs: PretixPrintlog[];
  answers: PretixAnswer[];
  downloads: PretixDownload[];
  plugin_data: object;
}

interface PretixInvoiceAddress {
  last_modified: DatetimeString;
  company: string;
  is_business: boolean;
  name: string;
  name_parts: Record<string, string>;
  street: string;
  zipcode: string;
  city: string;
  country: string;
  state: string;
  internal_reference: string;
  custom_field?: string;
  vat_id: string;
  vat_id_validated: boolean;
  transmission_type: string;
  transmission_info: Record<string, unknown> | null;
}

interface PretixOrderFee {
  id: number;
  fee_type: string;
  value: string;
  description: string;
  internal_type: string;
  tax_rate: string;
  tax_value: string;
  tax_rule: number | null;
  tax_code: string | null;
  canceled: boolean;
}

interface PretixOrderPayment {
  local_id: number;
  state: string;
  amount: string;
  created: DatetimeString;
  payment_date: DatetimeString | null;
  provider: string;
  payment_url: string | null;
  details: Record<string, unknown>;
}

interface PretixOrderRefund {
  local_id: number;
  state: string;
  source: string;
  amount: string;
  created: DatetimeString;
  comment: string | null;
  execution_date: DatetimeString | null;
  provider: string;
  details: Record<string, unknown>;
}

interface PretixOrder {
  code: string;
  event: string;
  status: 'n' | 'p' | 'e' | 'c';
  testmode: boolean;
  secret: string;
  email: string;
  phone: string | null;
  customer: string | null;
  locale: string;
  sales_channel: string;
  datetime: DatetimeString;
  expires: DatetimeString;
  /** DEPRECATED AND INACCURATE */
  payment_date: DateString | null;
  /** DEPRECATED AND INACCURATE */
  payment_provider: string | null;
  total: string;
  tax_rounding_mode: string;
  comment: string;
  api_meta?: Record<string, unknown>;
  custom_followup_at: DateString | null;
  checkin_attention: boolean;
  checkin_text: string | null;
  invoice_address: PretixInvoiceAddress | null;
  positions: PretixOrderPosition[];
  fees: PretixOrderFee[];
  downloads: PretixDownload[];
  require_approval: boolean;
  valid_if_pending: boolean;
  url: string;
  payments: PretixOrderPayment[];
  refunds: PretixOrderRefund[];
  last_modified: DatetimeString;
  cancellation_date: DatetimeString | null;
  plugin_data: Record<string, unknown>;
  use_gift_cards?: string[];
  answers?: PretixAnswer[];
}
