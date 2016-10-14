export let queries = {
  selectAll     : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t`",
  selectOne     : "select `t`.`id` as `t.id`, `t`.`task` as `t.task` from `todo` as `t`",
  selectArray   : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t",
  selectSum     : "select sum(`id`) from `todo` as `t`",
  insert        : "insert into `todo` as `t` (`task`, `done`) values ('Bake cake', true)",
  update        : "update `todo` set `done` = true where `id` = 1",
  limit         : "select `t`.`id` as `t.id`, `t`.`task` as `t.task` from `todo` as `t` limit 69",
  offset        : "select `t`.`id` as `t.id`, `t`.`done` as `t.done` from `todo` as `t` limit 5 offset 15",
  orderByAsc    : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` order by `task` asc",
  orderByDesc   : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` order by `done` desc",
  orderByDescObj: "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` order by `task` desc",
  orderByDescArr: "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` order by `done` desc",
  deleteById    : "delete from `todo` where `id` = 1",
  where         : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` where `done` = true",
  whereIn       : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` where `task` in ('Pet cat', 'Pet cat again')",
  whereAnd      : "select `t`.`id` as `t.id`, `t`.`task` as `t.task`, `t`.`done` as `t.done` from `todo` as `t` where `task` = 'Rob bank' and `done` = false",
  whereLTE      : "select `t`.`id` as `t.id`, `t`.`task` as `t.task` from `todo` as `t` where `id` <= 13"
};
