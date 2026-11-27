/**
 * Pretix API type definitions
 * @author Michael Townsend <@continuities>
 * @since 2026-11-22
 */

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

type PretixUnavailabilityMode = 'hide' | 'info';

type PretixMediaPolicy = 'new' | 'reuse' | 'reuse_or_new' | 'append' | 'append_or_new';

interface PretixItemVariation {
  id: number;
  value: MultilingualString;
  /** The price set directly on this variation, or null to inherit the item's default_price */
  default_price: string | null;
  /** The price actually used: default_price if set, otherwise the item's default_price */
  price: string;
  free_price_suggestion: string | null;
  original_price: string | null;
  active: boolean;
  description: MultilingualString | null;
  checkin_attention: boolean;
  checkin_text: string | null;
  require_approval: boolean;
  require_membership: boolean;
  /** Documented, but absent from the example responses */
  require_membership_hidden?: boolean;
  require_membership_types: number[];
  all_sales_channels: boolean;
  limit_sales_channels: string[];
  /** DEPRECATED. Use all_sales_channels and limit_sales_channels. */
  sales_channels: string[];
  available_from: DatetimeString | null;
  available_from_mode: PretixUnavailabilityMode;
  available_until: DatetimeString | null;
  available_until_mode: PretixUnavailabilityMode;
  hide_without_voucher: boolean;
  meta_data: Record<string, unknown>;
  position: number;
}

interface PretixItemAddon {
  /** ID of the item category the add-on can be chosen from */
  addon_category: number;
  min_count: number;
  max_count: number;
  position: number;
  /** Adding the same item more than once is allowed */
  multi_allowed: boolean;
  /** Adding this add-on to the item is free */
  price_included: boolean;
}

interface PretixItemBundle {
  /** ID of the item that is included */
  bundled_item: number;
  bundled_variation: number | null;
  count: number;
  /** Used to split the base item's price (e.g. for mixed taxation). Not added to the price. */
  designated_price: string;
}

interface PretixItemProgramTime {
  start: DatetimeString;
  end: DatetimeString;
}

interface PretixItem {
  id: number;
  name: MultilingualString;
  /** Only used in the backend */
  internal_name: string;
  default_price: string;
  category: number | null;
  active: boolean;
  /** May contain Markdown */
  description: MultilingualString | null;
  free_price: boolean;
  free_price_suggestion: string | null;
  /** Read-only. Set through tax_rule. */
  tax_rate: string;
  tax_rule: number | null;
  /** true for items that grant admission (e.g. tickets), false for add-ons, merchandise, etc. */
  admission: boolean;
  /** DEPRECATED (2027.1). true if an attached questionnaire asks for attendee name and/or email. */
  personalized: boolean;
  position: number;
  /** URL of the product picture */
  picture: string | null;
  all_sales_channels: boolean;
  limit_sales_channels: string[];
  /** DEPRECATED. Use all_sales_channels and limit_sales_channels. */
  sales_channels: string[];
  available_from: DatetimeString | null;
  available_from_mode: PretixUnavailabilityMode;
  available_until: DatetimeString | null;
  available_until_mode: PretixUnavailabilityMode;
  /** DEPRECATED. ID of a quota; the item is hidden while that quota is available. */
  hidden_if_available: number | null;
  /** ID of another item; this item is hidden while that item is available. */
  hidden_if_item_available: number | null;
  hidden_if_item_available_mode: PretixUnavailabilityMode;
  require_voucher: boolean;
  hide_without_voucher: boolean;
  allow_cancel: boolean;
  min_per_order: number | null;
  max_per_order: number | null;
  checkin_attention: boolean;
  checkin_text: string | null;
  original_price: string | null;
  require_approval: boolean;
  /** If true, the item is only available as part of bundles */
  require_bundling: boolean;
  require_membership: boolean;
  /** Documented, but absent from the example responses */
  require_membership_hidden?: boolean;
  require_membership_types: number[];
  grant_membership_type: number | null;
  grant_membership_duration_like_event: boolean;
  grant_membership_duration_days: number;
  grant_membership_duration_months: number;
  /**
   * null means no special validity behaviour. Documented, but absent from the
   * example responses.
   */
  validity_mode?: 'fixed' | 'dynamic' | null;
  validity_fixed_from: DatetimeString | null;
  validity_fixed_until: DatetimeString | null;
  validity_dynamic_duration_minutes: number | null;
  validity_dynamic_duration_hours: number | null;
  validity_dynamic_duration_days: number | null;
  validity_dynamic_duration_months: number | null;
  validity_dynamic_start_choice: boolean;
  /** The docs list the type as boolean, but describe a number of days and the example shows null. */
  validity_dynamic_start_choice_day_limit: number | null;
  /** null means the regular ticketing rules apply */
  generate_tickets: boolean | null;
  allow_waitinglist: boolean;
  /** If true, buying this product yields a gift card */
  issue_giftcard: boolean;
  /** Experimental. How to handle reusable media. */
  media_policy: PretixMediaPolicy | null;
  /** Experimental. Type of reusable media to work on. */
  media_type: string | null;
  /** null means the event default is used */
  show_quota_left: boolean | null;
  has_variations: boolean;
  /** Empty when has_variations is false */
  variations: PretixItemVariation[];
  addons: PretixItemAddon[];
  bundles: PretixItemBundle[];
  /** Added in 2025.9; absent on older versions */
  program_times?: PretixItemProgramTime[];
  meta_data: Record<string, unknown>;
}
