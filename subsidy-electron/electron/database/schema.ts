import { sqliteTable, text, integer, real, numeric, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ═══════════════════════════════════════════
//  村 / 组 表
// ═══════════════════════════════════════════

export const village = sqliteTable('village', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  villageName: text('village_name', { length: 50 }).notNull().unique(),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})

export const familyHousehold = sqliteTable('family_household', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdCode: text('household_code', { length: 30 }).notNull().unique(),
  householdName: text('household_name', { length: 50 }).notNull(),
  headFarmerId: integer('head_farmer_id'),
  villageId: integer('village_id').notNull().references(() => village.id),
  groupNo: integer('group_no').notNull().default(1),
  address: text('address', { length: 200 }),
  registeredAddress: text('registered_address', { length: 200 }),
  contractArea: numeric('contract_area'),
  confirmedArea: numeric('confirmed_area'),
  status: integer('status').notNull().default(1),
  isManuallyConfirmed: integer('is_manually_confirmed').notNull().default(0),
  manuallyConfirmedAt: text('manually_confirmed_at'),
  manuallyConfirmedBy: text('manually_confirmed_by', { length: 50 }),
  remark: text('remark'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  villageIdx: index('ix_family_household_village_id').on(table.villageId),
  headFarmerIdx: index('ix_family_household_head_farmer').on(table.headFarmerId),
}))

export const farmerProfile = sqliteTable('farmer_profile', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => familyHousehold.id),
  realName: text('real_name', { length: 50 }).notNull(),
  gender: integer('gender').notNull(), // 1男 2女
  idCard: text('id_card', { length: 18 }).notNull().unique(),
  phone: text('phone', { length: 20 }),
  bankCard: text('bank_card', { length: 25 }),
  bankName: text('bank_name', { length: 100 }),
  relation: text('relation', { length: 20 }).default('本人'),
  farmerStatus: integer('farmer_status').notNull().default(1), // 1在册 2注销 3迁出 4死亡
  ownVillageId: integer('own_village_id').references(() => village.id),
  ownGroupNo: integer('own_group_no'),
  remark: text('remark'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  householdIdx: index('ix_farmer_profile_household_id').on(table.householdId),
  idCardIdx: index('ix_farmer_profile_id_card').on(table.idCard),
}))

// ═══════════════════════════════════════════
//  补贴类型表
// ═══════════════════════════════════════════

export const subsidyType = sqliteTable('subsidy_type', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subsidyName: text('subsidy_name', { length: 100 }).notNull(),
  subsidyYear: integer('subsidy_year').notNull(),
  calcMode: text('calc_mode', { length: 10 }).notNull().default('fixed'),
  standardAmount: numeric('standard_amount'),
  standardUnit: text('standard_unit', { length: 20 }),
  fundSource: text('fund_source', { length: 50 }),
  category: text('category', { length: 50 }),
  season: text('season', { length: 20 }).notNull().default('全年单补'),
  applyDeadline: text('apply_deadline'),
  payStatus: integer('pay_status').notNull().default(0),
  description: text('description'),
  countTowardArea: integer('count_toward_area').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})

// ═══════════════════════════════════════════
//  补贴申请 & 发放
// ═══════════════════════════════════════════

export const subsidyApplication = sqliteTable('subsidy_application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  farmerId: integer('farmer_id').notNull().references(() => farmerProfile.id),
  beneficiaryId: integer('beneficiary_id').notNull().references(() => farmerProfile.id),
  subsidyTypeId: integer('subsidy_type_id').notNull().references(() => subsidyType.id),
  applyYear: integer('apply_year').notNull(),
  applyAmount: numeric('apply_amount'),
  actualAmount: numeric('actual_amount'),
  applyArea: numeric('apply_area'),
  contractArea: numeric('contract_area'),
  trustArea: numeric('trust_area'),
  noSubsidyArea: numeric('no_subsidy_area'),
  payStatus: integer('pay_status').notNull().default(0),
  payDate: text('pay_date'),
  applyVillageId: integer('apply_village_id').references(() => village.id),
  applyGroupNo: integer('apply_group_no'),
  applyVillageName: text('apply_village_name', { length: 50 }),
  applyGroupDisplay: text('apply_group_display', { length: 20 }),
  bankCardSnapshot: text('bank_card_snapshot', { length: 25 }),
  operatorId: integer('operator_id'),
  remark: text('remark'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
  isProxy: integer('is_proxy').notNull().default(0),
}, (table) => ({
  uniqueYear: uniqueIndex('uq_farmer_subsidy_year').on(table.farmerId, table.subsidyTypeId, table.applyYear),
  farmerYearIdx: index('ix_subsidy_application_farmer_year').on(table.farmerId, table.applyYear),
  subsidyTypeIdx: index('ix_subsidy_application_subsidy_type').on(table.subsidyTypeId),
}))

export const subsidyPayment = sqliteTable('subsidy_payment', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  farmerId: integer('farmer_id').notNull().references(() => farmerProfile.id),
  beneficiaryId: integer('beneficiary_id').notNull().references(() => farmerProfile.id),
  subsidyTypeId: integer('subsidy_type_id').notNull().references(() => subsidyType.id),
  paymentYear: integer('payment_year').notNull(),
  amount: numeric('amount'),
  paymentDate: text('payment_date'),
  paymentVillageId: integer('payment_village_id').references(() => village.id),
  paymentGroupNo: integer('payment_group_no'),
  paymentVillageName: text('payment_village_name', { length: 50 }),
  paymentGroupDisplay: text('payment_group_display', { length: 20 }),
  applyArea: numeric('apply_area'),
  contractArea: numeric('contract_area'),
  trustArea: numeric('trust_area'),
  noSubsidyArea: numeric('no_subsidy_area'),
  bankCard: text('bank_card', { length: 25 }),
  bankName: text('bank_name', { length: 50 }),
  operatorId: integer('operator_id'),
  remark: text('remark'),
  proxyRemark: text('proxy_remark'),
  payStatus: integer('pay_status').notNull().default(2),
  isProxy: integer('is_proxy').notNull().default(0),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  uniquePayment: uniqueIndex('uq_payment_farmer_subsidy_year').on(table.farmerId, table.subsidyTypeId, table.paymentYear),
  farmerYearIdx: index('ix_subsidy_payment_farmer_year').on(table.farmerId, table.paymentYear),
  subsidyTypeIdx: index('ix_subsidy_payment_subsidy_type').on(table.subsidyTypeId),
}))

export const subsidyProxy = sqliteTable('subsidy_proxy', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').references(() => subsidyApplication.id),
  paymentId: integer('payment_id').references(() => subsidyPayment.id),
  subsidyTypeId: integer('subsidy_type_id').references(() => subsidyType.id),
  beneficiaryFarmerId: integer('beneficiary_farmer_id').notNull().references(() => farmerProfile.id),
  proxyFarmerId: integer('proxy_farmer_id').notNull().references(() => farmerProfile.id),
  proxyType: text('proxy_type', { length: 20 }).notNull(),
  remark: text('remark'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  applicationIdx: index('ix_subsidy_proxy_application').on(table.applicationId),
  paymentIdx: index('ix_subsidy_proxy_payment').on(table.paymentId),
  beneficiaryIdx: index('ix_subsidy_proxy_beneficiary').on(table.beneficiaryFarmerId),
  proxyIdx: index('ix_subsidy_proxy_proxy').on(table.proxyFarmerId),
}))

// ═══════════════════════════════════════════
//  面积缓存 / 日志 / 资格规则
// ═══════════════════════════════════════════

export const householdAreaUsageCache = sqliteTable('household_area_usage_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => familyHousehold.id),
  year: integer('year').notNull(),
  season: text('season', { length: 20 }).notNull(),
  applyArea: numeric('apply_area').default('0'),
  paymentArea: numeric('payment_area').default('0'),
  usedArea: numeric('used_area').default('0'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  uniqueYearSeason: uniqueIndex('uq_hh_year_season').on(table.householdId, table.year, table.season),
  householdIdx: index('ix_hh_area_cache_household').on(table.householdId),
  yearIdx: index('ix_hh_area_cache_year').on(table.year),
}))

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operatorId: integer('operator_id'),
  operatorName: text('operator_name', { length: 50 }).notNull().default('系统'),
  action: text('action', { length: 50 }).notNull(),
  tableName: text('table_name', { length: 50 }).notNull(),
  recordId: integer('record_id'),
  beforeData: text('before_data'),
  afterData: text('after_data'),
  ipAddress: text('ip_address', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})

export const subsidyEligibilityRule = sqliteTable('subsidy_eligibility_rule', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  subsidyTypeId: integer('subsidy_type_id').notNull().references(() => subsidyType.id),
  ruleName: text('rule_name', { length: 100 }).notNull(),
  ruleDesc: text('rule_desc'),
  requireFarmerStatus: integer('require_farmer_status').default(1),
  requireAgeMin: integer('require_age_min'),
  requireAgeMax: integer('require_age_max'),
  requireLandType: text('require_land_type', { length: 20 }),
  requireMinArea: numeric('require_min_area'),
  requireMaxArea: numeric('require_max_area'),
  requireNotIdle: integer('require_not_idle').notNull().default(0),
  requireContractValid: integer('require_contract_valid').notNull().default(0),
  canCombineWithOthers: integer('can_combine_with_others').notNull().default(1),
  exclusiveWith: text('exclusive_with'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
})

// ═══════════════════════════════════════════
//  Excel 模板 / 导入日志
// ═══════════════════════════════════════════

export const excelColumnTemplate = sqliteTable('excel_column_template', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  templateName: text('template_name', { length: 200 }).notNull(),
  templateYear: integer('template_year'),
  regionName: text('region_name', { length: 100 }),
  businessType: text('business_type', { length: 20 }).notNull().default('SUBSIDY'),
  subsidyTypeId: integer('subsidy_type_id'),
  headerRow: integer('header_row').notNull().default(1),
  dataStartRow: integer('data_start_row').notNull().default(2),
  skipFooterRows: integer('skip_footer_rows').notNull().default(0),
  columnMapping: text('column_mapping').notNull(),
  skipRules: text('skip_rules'),
  valueMapping: text('value_mapping'),
  useCount: integer('use_count').notNull().default(0),
  lastUsedAt: text('last_used_at'),
  createdBy: text('created_by', { length: 50 }),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
})

export const excelImportLog = sqliteTable('excel_import_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  templateId: integer('template_id'),
  templateName: text('template_name', { length: 200 }),
  fileName: text('file_name', { length: 500 }).notNull(),
  fileHash: text('file_hash', { length: 64 }),
  businessType: text('business_type', { length: 20 }).notNull(),
  regionName: text('region_name', { length: 100 }),
  importYear: integer('import_year'),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  ruleFailedCount: integer('rule_failed_count').notNull().default(0),
  errorDetail: text('error_detail'),
  warningDetail: text('warning_detail'),
  ruleFailDetail: text('rule_fail_detail'),
  columnMappingUsed: text('column_mapping_used'),
  operator: text('operator', { length: 50 }),
  importDurationMs: integer('import_duration_ms'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})

// ═══════════════════════════════════════════
//  土地流转 / 家庭户事件 / 村组定义
// ═══════════════════════════════════════════

export const landTrust = sqliteTable('land_trust', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerHouseholdId: integer('owner_household_id').notNull().references(() => familyHousehold.id),
  operatorHouseholdId: integer('operator_household_id').references(() => familyHousehold.id),
  trustType: text('trust_type', { length: 20 }).notNull().default('ENTRUST'),
  area: numeric('area'),
  trustYear: integer('trust_year').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  annualFee: numeric('annual_fee'),
  paymentMethod: text('payment_method', { length: 20 }),
  feeNote: text('fee_note'),
  parcelDesc: text('parcel_desc', { length: 200 }),
  dataReliability: text('data_reliability', { length: 20 }).notNull().default('VILLAGE_CONFIRM'),
  affectSubsidyCalc: integer('affect_subsidy_calc').notNull().default(1),
  verifiedBy: text('verified_by', { length: 50 }),
  verifiedDate: text('verified_date'),
  note: text('note'),
  operator: text('operator', { length: 50 }),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
})

export const householdEvent = sqliteTable('household_event', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id').notNull().references(() => familyHousehold.id),
  relatedHhId: integer('related_hh_id'),
  eventType: text('event_type', { length: 30 }).notNull(),
  eventYear: integer('event_year').notNull(),
  eventDate: text('event_date'),
  dateAccuracy: text('date_accuracy', { length: 10 }).notNull().default('YEAR'),
  beforeSnapshot: text('before_snapshot'),
  afterSnapshot: text('after_snapshot'),
  farmerId: integer('farmer_id'),
  farmerName: text('farmer_name', { length: 50 }),
  description: text('description').notNull().default(''),
  evidenceType: text('evidence_type', { length: 20 }),
  evidenceNote: text('evidence_note', { length: 200 }),
  operator: text('operator', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  hhYearIdx: index('ix_household_event_hh_year').on(table.householdId, table.eventYear),
}))

export const villageGroup = sqliteTable('village_group', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  villageId: integer('village_id').notNull().references(() => village.id),
  groupNo: text('group_no', { length: 20 }).notNull(),
}, (table) => ({
  uniqueVillageGroup: uniqueIndex('uq_village_group').on(table.villageId, table.groupNo),
  villageIdx: index('ix_village_group_village').on(table.villageId),
}))

export const villageLandInfo = sqliteTable('village_land_info', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  villageId: integer('village_id').notNull().references(() => village.id).unique(),
  surveyYear: integer('survey_year'),
  paddyArea: numeric('paddy_area'),
  dryLandArea: numeric('dry_land_area'),
  arableArea: numeric('arable_area'),
  irrigationLevel: text('irrigation_level', { length: 20 }),
  terrainType: text('terrain_type', { length: 20 }),
  soilQuality: text('soil_quality', { length: 20 }),
  remark: text('remark'),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
})

// ═══════════════════════════════════════════
//  农业任务
// ═══════════════════════════════════════════

export const agriTask = sqliteTable('agri_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskName: text('task_name', { length: 100 }).notNull(),
  cropType: text('crop_type', { length: 30 }).notNull(),
  totalArea: numeric('total_area').notNull(),
  taskYear: integer('task_year').notNull(),
  season: text('season', { length: 20 }),
  allocMethod: text('alloc_method', { length: 30 }).notNull(),
  status: text('status', { length: 20 }).notNull().default('DRAFT'),
  description: text('description'),
  operator: text('operator', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
})

export const agriTaskAllocation = sqliteTable('agri_task_allocation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => agriTask.id),
  villageId: integer('village_id').notNull().references(() => village.id),
  villageName: text('village_name', { length: 50 }).notNull(),
  allocArea: numeric('alloc_area').notNull(),
  allocRatio: numeric('alloc_ratio'),
  basisArea: numeric('basis_area'),
  actualArea: numeric('actual_area'),
  remark: text('remark'),
}, (table) => ({
  uniqueTaskVillage: uniqueIndex('uq_agritask_village').on(table.taskId, table.villageId),
  taskIdx: index('ix_agri_task_alloc_task').on(table.taskId),
}))

// ═══════════════════════════════════════════
//  错误库
// ═══════════════════════════════════════════

export const errorLibrary = sqliteTable('error_library', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  realName: text('real_name', { length: 50 }).notNull(),
  idCard: text('id_card', { length: 18 }).notNull(),
  errorType: text('error_type', { length: 20 }).notNull(),
  errorReason: text('error_reason').notNull(),
  source: text('source', { length: 20 }).notNull().default('手动录入'),
  villageName: text('village_name', { length: 50 }),
  groupNo: text('group_no', { length: 20 }),
  subsidyName: text('subsidy_name', { length: 100 }),
  discoveredDate: text('discovered_date', { length: 10 }),
  subsidyTypeId: integer('subsidy_type_id'),
  remark: text('remark'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})

// ═══════════════════════════════════════════
//  大户 / 地块 / 代耕代种 / 合同提醒
// ═══════════════════════════════════════════

export const largeFarmer = sqliteTable('large_farmer', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operatorName: text('operator_name', { length: 100 }).notNull(),
  operatorType: text('operator_type', { length: 20 }).notNull().default('FAMILY_FARM'),
  idCard: text('id_card', { length: 18 }),
  phone: text('phone', { length: 20 }),
  bankCard: text('bank_card', { length: 25 }),
  bankName: text('bank_name', { length: 100 }),
  villageId: integer('village_id').notNull().references(() => village.id),
  groupNo: integer('group_no'),
  address: text('address', { length: 200 }),
  totalManagedArea: numeric('total_managed_area'),
  ownContractArea: numeric('own_contract_area'),
  trustInArea: numeric('trust_in_area'),
  mainCrops: text('main_crops', { length: 200 }),
  registrationNo: text('registration_no', { length: 50 }),
  registrationDate: text('registration_date'),
  farmerGrade: text('farmer_grade', { length: 20 }),
  creditScore: integer('credit_score'),
  status: integer('status').notNull().default(1),
  isVerified: integer('is_verified').notNull().default(0),
  verifiedBy: text('verified_by', { length: 50 }),
  verifiedDate: text('verified_date'),
  remark: text('remark'),
  operator: text('operator', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  villageIdx: index('ix_large_farmer_village_id').on(table.villageId),
  statusIdx: index('ix_large_farmer_status').on(table.status),
  idCardIdx: index('ix_large_farmer_id_card').on(table.idCard),
  gradeIdx: index('ix_large_farmer_grade').on(table.farmerGrade),
}))

export const largeFarmerParcel = sqliteTable('large_farmer_parcel', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  largeFarmerId: integer('large_farmer_id').notNull().references(() => largeFarmer.id),
  trustId: integer('trust_id'),
  parcelName: text('parcel_name', { length: 100 }),
  area: numeric('area').notNull(),
  villageId: integer('village_id').notNull().references(() => village.id),
  groupNo: integer('group_no'),
  parcelLocation: text('parcel_location', { length: 200 }),
  boundaryEast: text('boundary_east', { length: 100 }),
  boundaryWest: text('boundary_west', { length: 100 }),
  boundarySouth: text('boundary_south', { length: 100 }),
  boundaryNorth: text('boundary_north', { length: 100 }),
  isHighStandard: integer('is_high_standard').notNull().default(0),
  isDemonstration: integer('is_demonstration').notNull().default(0),
  zoneName: text('zone_name', { length: 100 }),
  zoneType: text('zone_type', { length: 50 }),
  soilGrade: text('soil_grade', { length: 20 }),
  soilType: text('soil_type', { length: 50 }),
  irrigationLevel: text('irrigation_level', { length: 20 }),
  mapCoordinates: text('map_coordinates'),
  mapGeojson: text('map_geojson'),
  mapCenterLng: numeric('map_center_lng'),
  mapCenterLat: numeric('map_center_lat'),
  mapZoom: integer('map_zoom'),
  currentCrop: text('current_crop', { length: 50 }),
  plantingSeason: text('planting_season', { length: 20 }),
  plantingYear: integer('planting_year'),
  isActive: integer('is_active').notNull().default(1),
  remark: text('remark'),
  operator: text('operator', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  lfIdx: index('ix_large_farmer_parcel_lf_id').on(table.largeFarmerId),
  villageIdx: index('ix_large_farmer_parcel_village_id').on(table.villageId),
  highStdIdx: index('ix_large_farmer_parcel_high_std').on(table.isHighStandard),
  demoIdx: index('ix_large_farmer_parcel_demo').on(table.isDemonstration),
  trustIdx: index('ix_large_farmer_parcel_trust_id').on(table.trustId),
}))

export const largeFarmerTrust = sqliteTable('large_farmer_trust', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  largeFarmerId: integer('large_farmer_id').notNull().references(() => largeFarmer.id),
  ownerHouseholdId: integer('owner_household_id').notNull().references(() => familyHousehold.id),
  landTrustId: integer('land_trust_id').references(() => landTrust.id),
  trustYear: integer('trust_year').notNull(),
  area: numeric('area').notNull(),
  trustType: text('trust_type', { length: 20 }).notNull().default('ENTRUST'),
  parcelVillageId: integer('parcel_village_id').references(() => village.id),
  parcelGroupNo: integer('parcel_group_no'),
  parcelDesc: text('parcel_desc', { length: 200 }),
  parcelLocation: text('parcel_location', { length: 200 }),
  isHighStandard: integer('is_high_standard').notNull().default(0),
  isDemonstration: integer('is_demonstration').notNull().default(0),
  zoneName: text('zone_name', { length: 100 }),
  contractNo: text('contract_no', { length: 50 }),
  startDate: text('start_date'),
  endDate: text('end_date'),
  reminderSent: integer('reminder_sent').notNull().default(0),
  reminderDays: integer('reminder_days'),
  annualFee: numeric('annual_fee'),
  totalFee: numeric('total_fee'),
  paymentMethod: text('payment_method', { length: 20 }),
  paymentStatus: text('payment_status', { length: 20 }),
  dataReliability: text('data_reliability', { length: 20 }).notNull().default('VILLAGE_CONFIRM'),
  isActive: integer('is_active').notNull().default(1),
  affectSubsidyCalc: integer('affect_subsidy_calc').notNull().default(1),
  note: text('note'),
  operator: text('operator', { length: 50 }),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now','localtime'))`),
}, (table) => ({
  lfIdx: index('ix_large_farmer_trust_lf_id').on(table.largeFarmerId),
  ownerIdx: index('ix_large_farmer_trust_owner_id').on(table.ownerHouseholdId),
  yearIdx: index('ix_large_farmer_trust_year').on(table.trustYear),
  landTrustIdx: index('ix_large_farmer_trust_land_trust').on(table.landTrustId),
  endDateIdx: index('ix_large_farmer_trust_end_date').on(table.endDate),
  parcelVillageIdx: index('ix_large_farmer_trust_parcel_village').on(table.parcelVillageId),
}))

export const largeFarmerContractReminder = sqliteTable('large_farmer_contract_reminder', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trustId: integer('trust_id').notNull().references(() => largeFarmerTrust.id),
  largeFarmerId: integer('large_farmer_id').notNull().references(() => largeFarmer.id),
  reminderType: text('reminder_type', { length: 20 }).notNull(),
  reminderDate: text('reminder_date').notNull(),
  contractEndDate: text('contract_end_date').notNull(),
  daysBefore: integer('days_before'),
  isSent: integer('is_sent').notNull().default(0),
  sentAt: text('sent_at'),
  note: text('note'),
  createdAt: text('created_at').default(sql`(datetime('now','localtime'))`),
})
