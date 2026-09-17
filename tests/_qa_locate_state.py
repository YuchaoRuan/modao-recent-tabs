# -*- coding: utf-8 -*-
"""QA 待办4 独立验证：左栏选中态 md-rt-located 的可逆性 / 清理 / React 污染 / 类名冲突。"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
import test_relocate_collapsed as T
from harness import start_server
from playwright.sync_api import sync_playwright


def snapshot_data(page, cid):
    return page.evaluate(
        """(cid) => {
             var li = document.querySelector('li.rn-content-item[data-cid=\"'+cid+'"]');
             var inner = li ? li.querySelector('.rn-list-item') : null;
             function grab(el){ if(!el) return {}; var o={}; for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i]; if(a.name.indexOf('data-')===0) o[a.name]=a.value;} return o; }
             return { li: grab(li), inner: grab(inner) };
           }""", cid)


def main():
    httpd, base = start_server()
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

        # ---- (a)(b)(c) 隔离我方实现（关闭墨刀自身激活类）----
        ctx, page = T.new_page(browser)
        T.boot(page, base)
        page.evaluate("() => window.__mock.setMoldeActive(false)")
        assert T.setup_full_render_scrolled_out(page, "G20"), "setup"
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        pre = snapshot_data(page, "G20")
        T.click_tab(page, "G20")
        page.wait_for_timeout(800)
        located1 = page.evaluate(
            "() => Array.from(document.querySelectorAll('.md-rt-located')).map(e=>{var li=e.closest('li.rn-content-item[data-cid]'); return li?li.getAttribute('data-cid'):'?';})")
        style_count1 = page.evaluate("() => document.querySelectorAll('style#md-recent-tabs-located').length")
        style_text = page.evaluate("() => { var s=document.querySelector('style#md-recent-tabs-located'); return s?s.textContent:''; }")
        post = snapshot_data(page, "G20")
        out["after_click_G20"] = {
            "located_cids": located1,
            "style_tag_count": style_count1,
            "style_has_important": ("!important" in style_text),
            "data_li_unchanged": (pre["li"] == post["li"]),
            "data_inner_unchanged": (pre["inner"] == post["inner"]),
        }
        # 切到 G25
        page.evaluate("() => window.__mock.setWrapped(false)")
        page.evaluate("() => window.__mock.setFullRender(false)")
        page.evaluate("(c) => window.__mock.scrollToCid(c)", "G25")
        page.wait_for_timeout(120)
        T.click_left(page, "G25")
        page.wait_for_timeout(250)
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.evaluate("() => window.__mock.setFullRender(true)")
        T.click_tab(page, "G25")
        page.wait_for_timeout(800)
        located2 = page.evaluate(
            "() => Array.from(document.querySelectorAll('.md-rt-located')).map(e=>{var li=e.closest('li.rn-content-item[data-cid]'); return li?li.getAttribute('data-cid'):'?';})")
        out["after_switch_G25"] = {"located_cids": located2}
        # destroy -> 必须清理
        page.evaluate("() => window.__ctrl.destroy()")
        page.wait_for_timeout(100)
        located_after_destroy = page.evaluate("() => document.querySelectorAll('.md-rt-located').length")
        style_after_destroy = page.evaluate("() => document.querySelectorAll('style#md-recent-tabs-located').length")
        out["after_destroy"] = {"located_count": located_after_destroy, "style_tag_count": style_after_destroy}
        ctx.close()

        # ---- (d) 类名无冲突：墨刀自身激活类存在时我方跳过；且不写 !important ----
        ctx, page = T.new_page(browser)
        T.boot(page, base)
        page.evaluate("() => window.__mock.setMoldeActive(true)")  # 允许墨刀自己给行加激活类
        assert T.setup_full_render_scrolled_out(page, "G20"), "setup2"
        T.click_tab(page, "G20")
        page.wait_for_timeout(800)
        # 检查：若某行带墨刀激活类，我方 md-rt-located 不应叠加其上（rowHasMoldeActive 短路）
        probe = page.evaluate(
            """() => {
                 var rows = Array.from(document.querySelectorAll('li.rn-content-item[data-cid] .rn-list-item'));
                 var conflict = false;
                 rows.forEach(function(r){
                   var molde = r.matches('.active,.is-active,.is-selected,.selected,.current,[aria-selected=\"true\"]') || (r.closest('li.rn-content-item') && r.closest('li.rn-content-item').matches('.active,.is-active,.is-selected,.selected,.current,[aria-selected=\"true\"]'));
                   var ours = r.classList.contains('md-rt-located');
                   if (molde && ours) conflict = true;
                 });
                 return { any_conflict: conflict };
               }""")
        out["class_conflict"] = probe
        ctx.close()

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    with open(os.path.join(root, "tests", "_qa_locate_state.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
