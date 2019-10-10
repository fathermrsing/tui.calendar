/**
 * @fileoverview Controller for Month View
 * @author NHN FE Development Lab <dl_javascript@nhn.com>
 */
import isUndefined from 'tui-code-snippet/type/isUndefined';
import inArray from 'tui-code-snippet/array/inArray';

import TZDate from '@src/time/date';
import Schedule from '@src/model/schedule';
import ScheduleViewModel from '@src/model/scheduleViewModel';
import Collection, { Filter } from '@src/util/collection';
import {
  limitRenderRange,
  getScheduleInDateRangeFilter,
  convertToViewModel,
  getCollisionGroup,
  getMatrices,
  positionViewModels
} from '@src/controller/core';
import { format, isSameDate, toEndOfDay, toStartOfDay } from '@src/time/datetime';
import ModelController, { IDS_OF_DAY } from './base';
import array from '@src/util/array';

/**
 * Filter function for find time schedule
 * @param {ScheduleViewModel} viewModel - schedule view model
 * @returns {boolean} whether model is time schedule?
 */
function _onlyTimeFilter(viewModel: ScheduleViewModel) {
  return !viewModel.model.isAllDay && !viewModel.model.hasMultiDates;
}

/**
 * Filter function for find allday schedule
 * @param {ScheduleViewModel} viewModel - schedule view model
 * @returns {boolean} whether model is allday schedule?
 */
function _onlyAlldayFilter(viewModel: ScheduleViewModel) {
  return viewModel.model.isAllDay || viewModel.model.hasMultiDates;
}

/**
 * Weight top value +1 for month view render
 * @param {ScheduleViewModel} viewModel - schedule view model
 */
function _weightTopValue(viewModel: ScheduleViewModel) {
  viewModel.top = viewModel.top || 0;
  viewModel.top += 1;
}

/**
 * Adjust render range to render properly.
 *
 * Limit start, end for each allday schedules and expand start, end for
 * each time schedules
 * @param {TZDate} start - render start date
 * @param {TZDate} end - render end date
 * @param {Collection} vColl - view model collection
 * property.
 */
function _adjustRenderRange(start: TZDate, end: TZDate, vColl: Collection<ScheduleViewModel>) {
  vColl.each(viewModel => {
    if (viewModel.model.isAllDay || viewModel.model.hasMultiDates) {
      limitRenderRange(start, end, viewModel);
    }
  });
}

/**
 * Get max top index value for allday schedules in specific date (YMD)
 * @param {string} ymd - yyyymmdd formatted value
 * @param {Collection} vAlldayColl - collection of allday schedules
 * @returns {number} max top index value in date
 */
function _getAlldayMaxTopIndexAtYMD(
  idsOfDay: IDS_OF_DAY,
  ymd: string,
  vAlldayColl: Collection<ScheduleViewModel>
) {
  const topIndexesInDate: number[] = [];

  idsOfDay[ymd].forEach(cid => {
    vAlldayColl.doWhenHas(cid, viewModel => {
      topIndexesInDate.push(viewModel.top);
    });
  });

  if (topIndexesInDate.length > 0) {
    return Math.max(...topIndexesInDate);
  }

  return 0;
}

/**
 * Adjust time view model's top index value
 * @param {Collection} vColl - collection of schedule view model
 */
function _adjustTimeTopIndex(idsOfDay: IDS_OF_DAY, vColl: Collection<ScheduleViewModel>) {
  const vAlldayColl = vColl.find(_onlyAlldayFilter);
  const sortedTimeSchedules = vColl.find(_onlyTimeFilter).sort(array.compare.schedule.asc);
  const maxIndexInYMD: Record<string, number> = {};

  sortedTimeSchedules.forEach(timeViewModel => {
    const scheduleYMD = format(timeViewModel.getStarts(), 'YYYYMMDD');
    let alldayMaxTopInYMD = maxIndexInYMD[scheduleYMD];

    if (isUndefined(alldayMaxTopInYMD)) {
      alldayMaxTopInYMD = maxIndexInYMD[scheduleYMD] = _getAlldayMaxTopIndexAtYMD(
        idsOfDay,
        scheduleYMD,
        vAlldayColl
      );
    }
    maxIndexInYMD[scheduleYMD] = timeViewModel.top = alldayMaxTopInYMD + 1;
  });
}

/**
 * Adjust time view model's top index value
 * @param {Collection} vColl - collection of schedule view model
 */
function _stackTimeFromTop(idsOfDay: IDS_OF_DAY, vColl: Collection<ScheduleViewModel>) {
  const vAlldayColl = vColl.find(_onlyAlldayFilter);
  const sortedTimeSchedules = vColl.find(_onlyTimeFilter).sort(array.compare.schedule.asc);
  const indiceInYMD: Record<string, number[]> = {};

  sortedTimeSchedules.forEach(timeViewModel => {
    const scheduleYMD = format(timeViewModel.getStarts(), 'YYYYMMDD');
    let topArrayInYMD = indiceInYMD[scheduleYMD];
    let maxTopInYMD;
    let i;

    if (isUndefined(topArrayInYMD)) {
      topArrayInYMD = indiceInYMD[scheduleYMD] = [];
      idsOfDay[scheduleYMD].forEach(cid => {
        vAlldayColl.doWhenHas(cid, viewModel => {
          topArrayInYMD.push(viewModel.top);
        });
      });
    }

    if (inArray(timeViewModel.top, topArrayInYMD) >= 0) {
      maxTopInYMD = Math.max(...topArrayInYMD) + 1;
      for (i = 1; i <= maxTopInYMD; i += 1) {
        timeViewModel.top = i;
        if (inArray(timeViewModel.top, topArrayInYMD) < 0) {
          break;
        }
      }
    }
    topArrayInYMD.push(timeViewModel.top);
  });
}

/**
 * Convert multi-date time schedule to all-day schedule
 * @param {Collection} vColl - view model collection
 * property.
 */
function _addMultiDatesInfo(vColl: Collection<ScheduleViewModel>) {
  vColl.each(viewModel => {
    const { model } = viewModel;
    const start = model.getStarts();
    const end = model.getEnds();

    model.hasMultiDates = !isSameDate(start, end);

    if (!model.isAllDay && model.hasMultiDates) {
      viewModel.renderStarts = toStartOfDay(start);
      viewModel.renderEnds = toEndOfDay(end);
    }
  });
}

/**
 * Find schedule and get view model for specific month
 * @param {ModelController} controller - model controller
 * @param {TZDate} start - start date to find schedules
 * @param {TZDate} end - end date to find schedules
 * @param {Filter[]} [andFilters] - optional filters to applying search query
 * @param {boolean} [alldayFirstMode=false] if true, time schedule is lower than all-day schedule. Or stack schedules from the top.
 * @returns {object} view model data
 */
export function findByDateRange(
  controller: ModelController,
  start: TZDate,
  end: TZDate,
  andFilters: Filter<Schedule | ScheduleViewModel>[] = [],
  alldayFirstMode = false
) {
  const filter = Collection.and(...[getScheduleInDateRangeFilter(start, end)].concat(andFilters));

  const coll = controller.schedules.find(filter);
  const vColl = convertToViewModel(coll);
  _addMultiDatesInfo(vColl);
  _adjustRenderRange(start, end, vColl);
  const vList = vColl.sort(array.compare.schedule.asc);

  const collisionGroup = getCollisionGroup(vList);
  const matrices = getMatrices(vColl, collisionGroup);
  positionViewModels(start, end, matrices, _weightTopValue);

  if (alldayFirstMode) {
    _adjustTimeTopIndex(controller.idsOfDay, vColl);
  } else {
    _stackTimeFromTop(controller.idsOfDay, vColl);
  }

  return matrices;
}
