//! **使い捨ての計測**（F7、calcarc-88 の `cases.json` 572 件を Rust へ落としたもの）。
//! **直す前と後を同じ物差しで測るためだけに置く。恒久の境界ケースは 88 の枝。**
use calcarc_core::Value;

enum Want {
    Finite(f64, f64),
    Overflow,
}

struct Case {
    id: &'static str,
    num: (f64, f64),
    den: (f64, f64),
    want: Want,
}

const CASES: &[Case] = &[
    Case {
        id: "max/sym/pp/self",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/pp/real_over_sym",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "max/sym/pp/double",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/pm/self",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/pm/real_over_sym",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "max/sym/pm/double",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/mp/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/mp/real_over_sym",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "max/sym/mp/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/mm/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/sym/mm/real_over_sym",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "max/sym/mm/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/pp/self",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9205357638345293823u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9205357638345293823u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/pp/double",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9205357638345293823u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9200854038717923327u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/pm/self",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18428729675200069631u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18428729675200069631u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/pm/double",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18428729675200069631u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18424226075572699135u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/mp/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9205357638345293823u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9205357638345293823u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/mp/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9205357638345293823u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9200854038717923327u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/mm/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18428729675200069631u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18428729675200069631u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/re_heavy/mm/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18428729675200069631u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18424226075572699135u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/pp/self",
        num: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/pp/double",
        num: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/pm/self",
        num: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/pm/double",
        num: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/mp/self",
        num: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/mp/double",
        num: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/mm/self",
        num: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/im_heavy/mm/double",
        num: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/pp/self",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/pp/double",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/pm/self",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/pm/double",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/mp/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/mp/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/mm/self",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_re/mm/double",
        num: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(9218868437227405311u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9218868437227405311u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(9218868437227405311u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9214364837600034815u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "max/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18442240474082181119u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/pp/self",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/pp/real_over_sym",
        num: (f64::from_bits(9214364837600034816u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "just_over_half/sym/pp/double",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9209861237972664320u64),
            f64::from_bits(9209861237972664320u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/pm/self",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/pm/real_over_sym",
        num: (f64::from_bits(9214364837600034816u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "just_over_half/sym/pm/double",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9209861237972664320u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/mp/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/mp/real_over_sym",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "just_over_half/sym/mp/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(9209861237972664320u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/mm/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/sym/mm/real_over_sym",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "just_over_half/sym/mm/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/pp/self",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9200854038717923328u64),
        ),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9200854038717923328u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/pp/double",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9200854038717923328u64),
        ),
        den: (
            f64::from_bits(9209861237972664320u64),
            f64::from_bits(9196350439090552832u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/pm/self",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18424226075572699136u64),
        ),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18424226075572699136u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/pm/double",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(18424226075572699136u64),
        ),
        den: (
            f64::from_bits(9209861237972664320u64),
            f64::from_bits(18419722475945328640u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/mp/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9200854038717923328u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9200854038717923328u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/mp/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9200854038717923328u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(9196350439090552832u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/mm/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18424226075572699136u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18424226075572699136u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/re_heavy/mm/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(18424226075572699136u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(18419722475945328640u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/pp/self",
        num: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/pp/double",
        num: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9196350439090552832u64),
            f64::from_bits(9209861237972664320u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/pm/self",
        num: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/pm/double",
        num: (
            f64::from_bits(9200854038717923328u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9196350439090552832u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/mp/self",
        num: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/mp/double",
        num: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(18419722475945328640u64),
            f64::from_bits(9209861237972664320u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/mm/self",
        num: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/im_heavy/mm/double",
        num: (
            f64::from_bits(18424226075572699136u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(18419722475945328640u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/pp/self",
        num: (f64::from_bits(9214364837600034816u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9214364837600034816u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/pp/double",
        num: (f64::from_bits(9214364837600034816u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9209861237972664320u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/pm/self",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/pm/double",
        num: (
            f64::from_bits(9214364837600034816u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9209861237972664320u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/mp/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/mp/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/mm/self",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_re/mm/double",
        num: (
            f64::from_bits(18437736874454810624u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18433233274827440128u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(9214364837600034816u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9214364837600034816u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(9214364837600034816u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9209861237972664320u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034816u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034816u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9209861237972664320u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810624u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "just_over_half/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810624u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18433233274827440128u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pp/self",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pp/real_over_sym",
        num: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "half_max/sym/pp/half",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pp/double",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9209861237972664319u64),
            f64::from_bits(9209861237972664319u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pm/self",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pm/real_over_sym",
        num: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "half_max/sym/pm/half",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/pm/double",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9209861237972664319u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mp/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mp/real_over_sym",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "half_max/sym/mp/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mp/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(9209861237972664319u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mm/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mm/real_over_sym",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "half_max/sym/mm/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/sym/mm/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pp/self",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9200854038717923327u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pp/half",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9205357638345293823u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pp/double",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(9209861237972664319u64),
            f64::from_bits(9196350439090552831u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pm/self",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18424226075572699135u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pm/half",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(18428729675200069631u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/pm/double",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(9209861237972664319u64),
            f64::from_bits(18419722475945328639u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mp/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9200854038717923327u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mp/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9205357638345293823u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mp/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9200854038717923327u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(9196350439090552831u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mm/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18424226075572699135u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mm/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(18428729675200069631u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/re_heavy/mm/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(18424226075572699135u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(18419722475945328639u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pp/self",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pp/half",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pp/double",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9196350439090552831u64),
            f64::from_bits(9209861237972664319u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pm/self",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pm/half",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9205357638345293823u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/pm/double",
        num: (
            f64::from_bits(9200854038717923327u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9196350439090552831u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mp/self",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mp/half",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mp/double",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(18419722475945328639u64),
            f64::from_bits(9209861237972664319u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mm/self",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mm/half",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18428729675200069631u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/im_heavy/mm/double",
        num: (
            f64::from_bits(18424226075572699135u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(18419722475945328639u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pp/self",
        num: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pp/half",
        num: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pp/double",
        num: (f64::from_bits(9214364837600034815u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9209861237972664319u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pm/self",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pm/half",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/pm/double",
        num: (
            f64::from_bits(9214364837600034815u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9209861237972664319u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mp/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mp/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mp/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mm/self",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mm/half",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18442240474082181119u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_re/mm/double",
        num: (
            f64::from_bits(18437736874454810623u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18433233274827440127u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(9214364837600034815u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9214364837600034815u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(9214364837600034815u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9218868437227405311u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(9214364837600034815u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9209861237972664319u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pm/half",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034815u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9218868437227405311u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214364837600034815u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9209861237972664319u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810623u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18442240474082181119u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "half_max/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18437736874454810623u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18433233274827440127u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/pp/self",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/pp/real_over_sym",
        num: (f64::from_bits(9214871658872686752u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e308/sym/pp/double",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9210368059245316256u64),
            f64::from_bits(9210368059245316256u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/pm/self",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/pm/real_over_sym",
        num: (f64::from_bits(9214871658872686752u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e308/sym/pm/double",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9210368059245316256u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/mp/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/mp/real_over_sym",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e308/sym/mp/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(9210368059245316256u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/mm/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/sym/mm/real_over_sym",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e308/sym/mm/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/pp/self",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9201360859990575264u64),
        ),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9201360859990575264u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/pp/double",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9201360859990575264u64),
        ),
        den: (
            f64::from_bits(9210368059245316256u64),
            f64::from_bits(9196857260363204768u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/pm/self",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18424732896845351072u64),
        ),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18424732896845351072u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/pm/double",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(18424732896845351072u64),
        ),
        den: (
            f64::from_bits(9210368059245316256u64),
            f64::from_bits(18420229297217980576u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/mp/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9201360859990575264u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9201360859990575264u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/mp/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9201360859990575264u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(9196857260363204768u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/mm/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18424732896845351072u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18424732896845351072u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/re_heavy/mm/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(18424732896845351072u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(18420229297217980576u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/pp/self",
        num: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/pp/double",
        num: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9196857260363204768u64),
            f64::from_bits(9210368059245316256u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/pm/self",
        num: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/pm/double",
        num: (
            f64::from_bits(9201360859990575264u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9196857260363204768u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/mp/self",
        num: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/mp/double",
        num: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(18420229297217980576u64),
            f64::from_bits(9210368059245316256u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/mm/self",
        num: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/im_heavy/mm/double",
        num: (
            f64::from_bits(18424732896845351072u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(18420229297217980576u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/pp/self",
        num: (f64::from_bits(9214871658872686752u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9214871658872686752u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/pp/double",
        num: (f64::from_bits(9214871658872686752u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9210368059245316256u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/pm/self",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/pm/double",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9210368059245316256u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/mp/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/mp/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/mm/self",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_re/mm/double",
        num: (
            f64::from_bits(18438243695727462560u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18433740096100092064u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(9214871658872686752u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9214871658872686752u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(9214871658872686752u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9210368059245316256u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214871658872686752u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9210368059245316256u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18438243695727462560u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e308/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18438243695727462560u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18433740096100092064u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pp/self",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pp/real_over_sym",
        num: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e307/sym/pp/half",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9204367112530588723u64),
            f64::from_bits(9204367112530588723u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pp/double",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9195359913275847731u64),
            f64::from_bits(9195359913275847731u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pm/self",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pm/real_over_sym",
        num: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e307/sym/pm/half",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9204367112530588723u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/pm/double",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9195359913275847731u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mp/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mp/real_over_sym",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e307/sym/mp/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(9204367112530588723u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mp/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(9195359913275847731u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mm/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mm/real_over_sym",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e307/sym/mm/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/sym/mm/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pp/self",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9186352714021106739u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pp/half",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(9204367112530588723u64),
            f64::from_bits(9190856313648477235u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pp/double",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(9195359913275847731u64),
            f64::from_bits(9181849114393736243u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pm/self",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18409724750875882547u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pm/half",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(9204367112530588723u64),
            f64::from_bits(18414228350503253043u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/pm/double",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(9195359913275847731u64),
            f64::from_bits(18405221151248512051u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mp/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9186352714021106739u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mp/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(9190856313648477235u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mp/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9186352714021106739u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(9181849114393736243u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mm/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18409724750875882547u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mm/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(18414228350503253043u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/re_heavy/mm/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(18409724750875882547u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(18405221151248512051u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pp/self",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pp/half",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9190856313648477235u64),
            f64::from_bits(9204367112530588723u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pp/double",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9181849114393736243u64),
            f64::from_bits(9195359913275847731u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pm/self",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pm/half",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9190856313648477235u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/pm/double",
        num: (
            f64::from_bits(9186352714021106739u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9181849114393736243u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mp/self",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mp/half",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18414228350503253043u64),
            f64::from_bits(9204367112530588723u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mp/double",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(18405221151248512051u64),
            f64::from_bits(9195359913275847731u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mm/self",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mm/half",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18414228350503253043u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/im_heavy/mm/double",
        num: (
            f64::from_bits(18409724750875882547u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(18405221151248512051u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pp/self",
        num: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pp/half",
        num: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9204367112530588723u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pp/double",
        num: (f64::from_bits(9199863512903218227u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9195359913275847731u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pm/self",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pm/half",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9204367112530588723u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/pm/double",
        num: (
            f64::from_bits(9199863512903218227u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9195359913275847731u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mp/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mp/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mp/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mm/self",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mm/half",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18427739149385364531u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_re/mm/double",
        num: (
            f64::from_bits(18423235549757994035u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(18418731950130623539u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(9199863512903218227u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9199863512903218227u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(9199863512903218227u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9204367112530588723u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(9199863512903218227u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9195359913275847731u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pm/half",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9199863512903218227u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9204367112530588723u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9199863512903218227u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9195359913275847731u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18423235549757994035u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18427739149385364531u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e307/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18423235549757994035u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(18418731950130623539u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pp/self",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pp/real_over_sym",
        num: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "one/sym/pp/half",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4611686018427387904u64),
            f64::from_bits(4611686018427387904u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pp/double",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pm/self",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pm/real_over_sym",
        num: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "one/sym/pm/half",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4611686018427387904u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/pm/double",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mp/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mp/real_over_sym",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "one/sym/mp/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(4611686018427387904u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mp/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(4602678819172646912u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mm/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mm/real_over_sym",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "one/sym/mm/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/sym/mm/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pp/self",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4593671619917905920u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pp/half",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(4611686018427387904u64),
            f64::from_bits(4598175219545276416u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pp/double",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4589168020290535424u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pm/self",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13817043656772681728u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pm/half",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(4611686018427387904u64),
            f64::from_bits(13821547256400052224u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/pm/double",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13812540057145311232u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mp/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4593671619917905920u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mp/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(4598175219545276416u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mp/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(4593671619917905920u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(4589168020290535424u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mm/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13817043656772681728u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mm/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(13821547256400052224u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/re_heavy/mm/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(13817043656772681728u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(13812540057145311232u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pp/self",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pp/half",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4598175219545276416u64),
            f64::from_bits(4611686018427387904u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pp/double",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(4589168020290535424u64),
            f64::from_bits(4602678819172646912u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pm/self",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pm/half",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4598175219545276416u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/pm/double",
        num: (
            f64::from_bits(4593671619917905920u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(4589168020290535424u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mp/self",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mp/half",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13821547256400052224u64),
            f64::from_bits(4611686018427387904u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mp/double",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(13812540057145311232u64),
            f64::from_bits(4602678819172646912u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mm/self",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mm/half",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13821547256400052224u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/im_heavy/mm/double",
        num: (
            f64::from_bits(13817043656772681728u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(13812540057145311232u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pp/self",
        num: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pp/half",
        num: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pp/double",
        num: (f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pm/self",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pm/half",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4611686018427387904u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/pm/double",
        num: (
            f64::from_bits(4607182418800017408u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mp/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mp/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mp/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mm/self",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mm/half",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13835058055282163712u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_re/mm/double",
        num: (
            f64::from_bits(13830554455654793216u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13826050856027422720u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(4607182418800017408u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4607182418800017408u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(4607182418800017408u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4611686018427387904u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(4607182418800017408u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4602678819172646912u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pm/half",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4607182418800017408u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4611686018427387904u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4607182418800017408u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4602678819172646912u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13830554455654793216u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13835058055282163712u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "one/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13830554455654793216u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13826050856027422720u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pp/self",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pp/real_over_sym",
        num: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e-6/sym/pp/half",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4521832792735477133u64),
            f64::from_bits(4521832792735477133u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pp/double",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4512825593480736141u64),
            f64::from_bits(4512825593480736141u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pm/self",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pm/real_over_sym",
        num: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e-6/sym/pm/half",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4521832792735477133u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/pm/double",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4512825593480736141u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mp/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mp/real_over_sym",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e-6/sym/mp/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(4521832792735477133u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mp/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(4512825593480736141u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mm/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mm/real_over_sym",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e-6/sym/mm/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/sym/mm/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pp/self",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4503818394225995149u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pp/half",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(4521832792735477133u64),
            f64::from_bits(4508321993853365645u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pp/double",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(4512825593480736141u64),
            f64::from_bits(4499314794598624653u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pm/self",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13727190431080770957u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pm/half",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(4521832792735477133u64),
            f64::from_bits(13731694030708141453u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/pm/double",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(4512825593480736141u64),
            f64::from_bits(13722686831453400461u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mp/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4503818394225995149u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mp/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(4508321993853365645u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mp/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(4503818394225995149u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(4499314794598624653u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mm/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13727190431080770957u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mm/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(13731694030708141453u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/re_heavy/mm/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(13727190431080770957u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(13722686831453400461u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pp/self",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pp/half",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4508321993853365645u64),
            f64::from_bits(4521832792735477133u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pp/double",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(4499314794598624653u64),
            f64::from_bits(4512825593480736141u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pm/self",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pm/half",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4508321993853365645u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/pm/double",
        num: (
            f64::from_bits(4503818394225995149u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(4499314794598624653u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mp/self",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mp/half",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13731694030708141453u64),
            f64::from_bits(4521832792735477133u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mp/double",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(13722686831453400461u64),
            f64::from_bits(4512825593480736141u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mm/self",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mm/half",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13731694030708141453u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/im_heavy/mm/double",
        num: (
            f64::from_bits(13727190431080770957u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(13722686831453400461u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pp/self",
        num: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pp/half",
        num: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4521832792735477133u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pp/double",
        num: (f64::from_bits(4517329193108106637u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4512825593480736141u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pm/self",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pm/half",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4521832792735477133u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/pm/double",
        num: (
            f64::from_bits(4517329193108106637u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4512825593480736141u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mp/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mp/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mp/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(0u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(0u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mm/self",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mm/half",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13745204829590252941u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_re/mm/double",
        num: (
            f64::from_bits(13740701229962882445u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(13736197630335511949u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(4517329193108106637u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4517329193108106637u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(4517329193108106637u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4521832792735477133u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(4517329193108106637u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4512825593480736141u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pm/self",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pm/half",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/pm/double",
        num: (
            f64::from_bits(0u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(0u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4517329193108106637u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4521832792735477133u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4517329193108106637u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4512825593480736141u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13740701229962882445u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13745204829590252941u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-6/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13740701229962882445u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(13736197630335511949u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pp/self",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pp/real_over_sym",
        num: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "min_normal/sym/pp/half",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9007199254740992u64),
            f64::from_bits(9007199254740992u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pp/double",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(2251799813685248u64),
            f64::from_bits(2251799813685248u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pm/self",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pm/real_over_sym",
        num: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "min_normal/sym/pm/half",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9007199254740992u64),
            f64::from_bits(9232379236109516800u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/pm/double",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(2251799813685248u64),
            f64::from_bits(9225623836668461056u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mp/self",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mp/real_over_sym",
        num: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "min_normal/sym/mp/half",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9232379236109516800u64),
            f64::from_bits(9007199254740992u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mp/double",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9225623836668461056u64),
            f64::from_bits(2251799813685248u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mm/self",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mm/real_over_sym",
        num: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "min_normal/sym/mm/half",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9232379236109516800u64),
            f64::from_bits(9232379236109516800u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/sym/mm/double",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9225623836668461056u64),
            f64::from_bits(9225623836668461056u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pp/self",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(562949953421312u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pp/half",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(9007199254740992u64),
            f64::from_bits(1125899906842624u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pp/double",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(2251799813685248u64),
            f64::from_bits(281474976710656u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pm/self",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223934986808197120u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pm/half",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(9007199254740992u64),
            f64::from_bits(9224497936761618432u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/pm/double",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(2251799813685248u64),
            f64::from_bits(9223653511831486464u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mp/self",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(562949953421312u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mp/half",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(9232379236109516800u64),
            f64::from_bits(1125899906842624u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mp/double",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(562949953421312u64),
        ),
        den: (
            f64::from_bits(9225623836668461056u64),
            f64::from_bits(281474976710656u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mm/self",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223934986808197120u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mm/half",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(9232379236109516800u64),
            f64::from_bits(9224497936761618432u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/re_heavy/mm/double",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223934986808197120u64),
        ),
        den: (
            f64::from_bits(9225623836668461056u64),
            f64::from_bits(9223653511831486464u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pp/self",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pp/half",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(1125899906842624u64),
            f64::from_bits(9007199254740992u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pp/double",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(281474976710656u64),
            f64::from_bits(2251799813685248u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pm/self",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pm/half",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(1125899906842624u64),
            f64::from_bits(9232379236109516800u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/pm/double",
        num: (
            f64::from_bits(562949953421312u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(281474976710656u64),
            f64::from_bits(9225623836668461056u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mp/self",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mp/half",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9224497936761618432u64),
            f64::from_bits(9007199254740992u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mp/double",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9223653511831486464u64),
            f64::from_bits(2251799813685248u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mm/self",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mm/half",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9224497936761618432u64),
            f64::from_bits(9232379236109516800u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/im_heavy/mm/double",
        num: (
            f64::from_bits(9223934986808197120u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9223653511831486464u64),
            f64::from_bits(9225623836668461056u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pp/self",
        num: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pp/half",
        num: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9007199254740992u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pp/double",
        num: (f64::from_bits(4503599627370496u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2251799813685248u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pm/self",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pm/half",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9007199254740992u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/pm/double",
        num: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(2251799813685248u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mp/self",
        num: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mp/half",
        num: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9232379236109516800u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mp/double",
        num: (f64::from_bits(9227875636482146304u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9225623836668461056u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mm/self",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mm/half",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9232379236109516800u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_re/mm/double",
        num: (
            f64::from_bits(9227875636482146304u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9225623836668461056u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(4503599627370496u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4503599627370496u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(4503599627370496u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9007199254740992u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(4503599627370496u64)),
        den: (f64::from_bits(0u64), f64::from_bits(2251799813685248u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pm/self",
        num: (f64::from_bits(0u64), f64::from_bits(9227875636482146304u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9227875636482146304u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pm/half",
        num: (f64::from_bits(0u64), f64::from_bits(9227875636482146304u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9232379236109516800u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/pm/double",
        num: (f64::from_bits(0u64), f64::from_bits(9227875636482146304u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9225623836668461056u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9007199254740992u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4503599627370496u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(2251799813685248u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9227875636482146304u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9232379236109516800u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_normal/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9227875636482146304u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9225623836668461056u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pp/self",
        num: (f64::from_bits(2024u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(2024u64), f64::from_bits(2024u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pp/real_over_sym",
        num: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2024u64), f64::from_bits(2024u64)),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e-320/sym/pp/half",
        num: (f64::from_bits(2024u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(4048u64), f64::from_bits(4048u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pp/double",
        num: (f64::from_bits(2024u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(1012u64), f64::from_bits(1012u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pm/self",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pm/real_over_sym",
        num: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e-320/sym/pm/half",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(4048u64),
            f64::from_bits(9223372036854779856u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/pm/double",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(1012u64),
            f64::from_bits(9223372036854776820u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mp/self",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(2024u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mp/real_over_sym",
        num: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(2024u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "e-320/sym/mp/half",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854779856u64),
            f64::from_bits(4048u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mp/double",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854776820u64),
            f64::from_bits(1012u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mm/self",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mm/real_over_sym",
        num: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "e-320/sym/mm/half",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854779856u64),
            f64::from_bits(9223372036854779856u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/sym/mm/double",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854776820u64),
            f64::from_bits(9223372036854776820u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/pp/self",
        num: (f64::from_bits(2024u64), f64::from_bits(253u64)),
        den: (f64::from_bits(2024u64), f64::from_bits(253u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/pp/half",
        num: (f64::from_bits(2024u64), f64::from_bits(253u64)),
        den: (f64::from_bits(4048u64), f64::from_bits(506u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/pp/double",
        num: (f64::from_bits(2024u64), f64::from_bits(253u64)),
        den: (f64::from_bits(1012u64), f64::from_bits(126u64)),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(4562114101159782291u64),
        ),
    },
    Case {
        id: "e-320/re_heavy/pm/self",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854776061u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/pm/half",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(4048u64),
            f64::from_bits(9223372036854776314u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/pm/double",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(1012u64),
            f64::from_bits(9223372036854775934u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(13785486138014558099u64),
        ),
    },
    Case {
        id: "e-320/re_heavy/mp/self",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(253u64),
        ),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(253u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/mp/half",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(253u64),
        ),
        den: (
            f64::from_bits(9223372036854779856u64),
            f64::from_bits(506u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/mp/double",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(253u64),
        ),
        den: (
            f64::from_bits(9223372036854776820u64),
            f64::from_bits(126u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(13785486138014558099u64),
        ),
    },
    Case {
        id: "e-320/re_heavy/mm/self",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854776061u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/mm/half",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(9223372036854779856u64),
            f64::from_bits(9223372036854776314u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/re_heavy/mm/double",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854776061u64),
        ),
        den: (
            f64::from_bits(9223372036854776820u64),
            f64::from_bits(9223372036854775934u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(4562114101159782291u64),
        ),
    },
    Case {
        id: "e-320/im_heavy/pp/self",
        num: (f64::from_bits(253u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(253u64), f64::from_bits(2024u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/pp/half",
        num: (f64::from_bits(253u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(506u64), f64::from_bits(4048u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/pp/double",
        num: (f64::from_bits(253u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(126u64), f64::from_bits(1012u64)),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(13785486138014558099u64),
        ),
    },
    Case {
        id: "e-320/im_heavy/pm/self",
        num: (
            f64::from_bits(253u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(253u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/pm/half",
        num: (
            f64::from_bits(253u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(506u64),
            f64::from_bits(9223372036854779856u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/pm/double",
        num: (
            f64::from_bits(253u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(126u64),
            f64::from_bits(9223372036854776820u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(4562114101159782291u64),
        ),
    },
    Case {
        id: "e-320/im_heavy/mp/self",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(2024u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/mp/half",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854776314u64),
            f64::from_bits(4048u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/mp/double",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854775934u64),
            f64::from_bits(1012u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(4562114101159782291u64),
        ),
    },
    Case {
        id: "e-320/im_heavy/mm/self",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/mm/half",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854776314u64),
            f64::from_bits(9223372036854779856u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/im_heavy/mm/double",
        num: (
            f64::from_bits(9223372036854776061u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854775934u64),
            f64::from_bits(9223372036854776820u64),
        ),
        want: Want::Finite(
            f64::from_bits(4611686291236349774u64),
            f64::from_bits(13785486138014558099u64),
        ),
    },
    Case {
        id: "e-320/pure_re/pp/self",
        num: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/pp/half",
        num: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        den: (f64::from_bits(4048u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/pp/double",
        num: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1012u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/pm/self",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/pm/half",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(4048u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/pm/double",
        num: (
            f64::from_bits(2024u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(1012u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mp/self",
        num: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mp/half",
        num: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854779856u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mp/double",
        num: (f64::from_bits(9223372036854777832u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854776820u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mm/self",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mm/half",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854779856u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_re/mm/double",
        num: (
            f64::from_bits(9223372036854777832u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854776820u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(0u64), f64::from_bits(2024u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(0u64), f64::from_bits(4048u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pp/double",
        num: (f64::from_bits(0u64), f64::from_bits(2024u64)),
        den: (f64::from_bits(0u64), f64::from_bits(1012u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pm/self",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854777832u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854777832u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pm/half",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854777832u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854779856u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/pm/double",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854777832u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854776820u64)),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mp/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(2024u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mp/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(4048u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mp/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(2024u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(1012u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854777832u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854779856u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "e-320/pure_im/mm/double",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854777832u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854776820u64),
        ),
        want: Want::Finite(f64::from_bits(4611686018427387904u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/pp/self",
        num: (f64::from_bits(1u64), f64::from_bits(1u64)),
        den: (f64::from_bits(1u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/pp/real_over_sym",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(1u64)),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "min_sub/sym/pp/half",
        num: (f64::from_bits(1u64), f64::from_bits(1u64)),
        den: (f64::from_bits(2u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/pm/self",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(1u64), f64::from_bits(9223372036854775809u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/pm/real_over_sym",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(9223372036854775809u64)),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "min_sub/sym/pm/half",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(2u64), f64::from_bits(9223372036854775810u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/mp/self",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775809u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/mp/real_over_sym",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854775809u64), f64::from_bits(1u64)),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(4602678819172646912u64),
        ),
    },
    Case {
        id: "min_sub/sym/mp/half",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775810u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/mm/self",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775809u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/sym/mm/real_over_sym",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775809u64),
        ),
        want: Want::Finite(
            f64::from_bits(4602678819172646912u64),
            f64::from_bits(13826050856027422720u64),
        ),
    },
    Case {
        id: "min_sub/sym/mm/half",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775810u64),
            f64::from_bits(9223372036854775810u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/pp/self",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/pp/half",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/pm/self",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        den: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/pm/half",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        den: (f64::from_bits(2u64), f64::from_bits(9223372036854775808u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/mp/self",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/mp/half",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854775810u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/mm/self",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/re_heavy/mm/half",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854775810u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(1u64)),
        den: (f64::from_bits(0u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(1u64)),
        den: (f64::from_bits(0u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/pm/self",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/pm/half",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854775810u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/mp/self",
        num: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/mp/half",
        num: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775808u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/im_heavy/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775810u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/pp/self",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/pp/half",
        num: (f64::from_bits(1u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/pm/self",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        den: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/pm/half",
        num: (f64::from_bits(1u64), f64::from_bits(9223372036854775808u64)),
        den: (f64::from_bits(2u64), f64::from_bits(9223372036854775808u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/mp/self",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/mp/half",
        num: (f64::from_bits(9223372036854775809u64), f64::from_bits(0u64)),
        den: (f64::from_bits(9223372036854775810u64), f64::from_bits(0u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/mm/self",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_re/mm/half",
        num: (
            f64::from_bits(9223372036854775809u64),
            f64::from_bits(9223372036854775808u64),
        ),
        den: (
            f64::from_bits(9223372036854775810u64),
            f64::from_bits(9223372036854775808u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/pp/self",
        num: (f64::from_bits(0u64), f64::from_bits(1u64)),
        den: (f64::from_bits(0u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/pp/half",
        num: (f64::from_bits(0u64), f64::from_bits(1u64)),
        den: (f64::from_bits(0u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/pm/self",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/pm/half",
        num: (f64::from_bits(0u64), f64::from_bits(9223372036854775809u64)),
        den: (f64::from_bits(0u64), f64::from_bits(9223372036854775810u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/mp/self",
        num: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/mp/half",
        num: (f64::from_bits(9223372036854775808u64), f64::from_bits(1u64)),
        den: (f64::from_bits(9223372036854775808u64), f64::from_bits(2u64)),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/mm/self",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        want: Want::Finite(f64::from_bits(4607182418800017408u64), f64::from_bits(0u64)),
    },
    Case {
        id: "min_sub/pure_im/mm/half",
        num: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775809u64),
        ),
        den: (
            f64::from_bits(9223372036854775808u64),
            f64::from_bits(9223372036854775810u64),
        ),
        want: Want::Finite(f64::from_bits(4602678819172646912u64), f64::from_bits(0u64)),
    },
    Case {
        id: "genuine/max_sym_over_min_sub_re",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (f64::from_bits(1u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_re_over_min_sub_re",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/e308_sym_over_min_sub_re",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (f64::from_bits(1u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_sym_over_min_sub_sym",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (f64::from_bits(1u64), f64::from_bits(1u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_re_over_min_sub_sym",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (f64::from_bits(1u64), f64::from_bits(1u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/e308_sym_over_min_sub_sym",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (f64::from_bits(1u64), f64::from_bits(1u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_sym_over_min_normal_sym",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_re_over_min_normal_sym",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/e308_sym_over_min_normal_sym",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (
            f64::from_bits(4503599627370496u64),
            f64::from_bits(4503599627370496u64),
        ),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_sym_over_e-320_re",
        num: (
            f64::from_bits(9218868437227405311u64),
            f64::from_bits(9218868437227405311u64),
        ),
        den: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/max_re_over_e-320_re",
        num: (f64::from_bits(9218868437227405311u64), f64::from_bits(0u64)),
        den: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
    Case {
        id: "genuine/e308_sym_over_e-320_re",
        num: (
            f64::from_bits(9214871658872686752u64),
            f64::from_bits(9214871658872686752u64),
        ),
        den: (f64::from_bits(2024u64), f64::from_bits(0u64)),
        want: Want::Overflow,
    },
];

#[test]
fn f7_measure() {
    let (mut silent_zero, mut false_overflow, mut wrong_value, mut wrong_way, mut ok) =
        (0, 0, 0, 0, 0);
    let mut examples: Vec<String> = Vec::new();
    for c in CASES {
        let got = Value::new(c.num.0, c.num.1).checked_div(Value::new(c.den.0, c.den.1));
        match (&c.want, got) {
            (Want::Finite(wr, wi), Ok(v)) => {
                if v.re == *wr && v.im == *wi {
                    ok += 1;
                } else if v.re == 0.0 && v.im == 0.0 {
                    silent_zero += 1;
                    if examples.len() < 6 {
                        examples.push(format!("silent0 {} -> 0 want {wr}+{wi}j", c.id));
                    }
                } else {
                    wrong_value += 1;
                    // **ここは上限を付けない。** 件数は数え、例は 6 件で切る、と
                    // していたら**印字 6 行を件数と読み違えかけた**（2026-09-18）。
                    // **残っている差は全部見えるようにする。**
                    examples.push(format!(
                        "value {} -> {}+{}j want {wr}+{wi}j",
                        c.id, v.re, v.im
                    ));
                }
            }
            (Want::Finite(_, _), Err(e)) => {
                false_overflow += 1;
                if examples.len() < 6 {
                    examples.push(format!("false-{e:?} {}", c.id));
                }
            }
            (Want::Overflow, Err(_)) => ok += 1,
            (Want::Overflow, Ok(v)) => {
                wrong_way += 1;
                examples.push(format!("WRONG-WAY {} -> {}+{}j", c.id, v.re, v.im));
            }
        }
    }
    println!(
        "F7 measure: total={} ok={ok} silent_zero={silent_zero} false_overflow={false_overflow} wrong_value={wrong_value} wrong_way={wrong_way}",
        CASES.len()
    );
    for e in &examples {
        println!("  {e}");
    }
    // **0 でなければならない 3 つ**——**壊れ方そのもの**である。
    assert_eq!(silent_zero, 0, "静かに嘘の答え（有限の正解を 0 に潰す）");
    assert_eq!(false_overflow, 0, "偽 Overflow（有限の正解を拒む）");
    assert_eq!(wrong_way, 0, "範囲外なのに値を返す（逆向き。新しい不具合）");
    // **残りは非正規化域の 1 ULP**（実部・虚部とも ULP 差 1、相対 2.2e-16 / 1.1e-16）。
    // **Smith 法は丸めを 2 回通すので、正しく丸めた商とのビット一致は保証できない。**
    // **比べ方（ビット一致か許容か）は裁定待ち**——**許容をテストコードに書かない**
    // のがこのリポジトリの規律なので、**置き場が決まるまでは数を固定するだけにする。**
    assert!(
        wrong_value <= 8,
        "1 ULP の差が 8 件より増えた: {wrong_value}"
    );
}
