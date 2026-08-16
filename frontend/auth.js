(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function normalizePhone(phone) {
    if (
      window.ESPANStore &&
      typeof window.ESPANStore.normalizePhone === "function"
    ) {
      return window.ESPANStore.normalizePhone(phone);
    }

    return String(phone || "")
      .replace(/[\s()+-]/g, "")
      .replace(/^218/, "0");
  }

  function isValidLibyanPhone(phone) {
    return /^0(91|92|93|94|95)\d{7}$/.test(
      normalizePhone(phone)
    );
  }

  function setMessage(element, text, type) {
    if (!element) return;

    element.textContent = text || "";

    element.className = text
      ? `form-message show ${type || "error"}`
      : "form-message";
  }

  function clearField(input, error) {
    input?.classList.remove("invalid");

    if (error) {
      error.textContent = "";
    }
  }

  function fieldError(input, error, text) {
    input?.classList.add("invalid");

    if (error) {
      error.textContent = text;
    }
  }

  async function recoverPassword(data) {
    let response;

    try {
      response = await fetch("/api/auth/recover", {
        method: "POST",

        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json;charset=UTF-8"
        },

        body: JSON.stringify(data),

        cache: "no-store"
      });

    } catch (_) {
      return {
        ok: false,
        message: "تعذر الاتصال بالخادم. تأكدي أن المشروع شغال."
      };
    }

    let payload = {};

    try {
      payload = await response.json();
    } catch (_) {
      payload = {};
    }

    if (
      response.ok &&
      payload.ok !== false
    ) {
      return {
        ok: true,
        ...payload
      };
    }

    return {
      ok: false,
      message:
        payload.message ||
        `خطأ من الخادم (${response.status})`,
      ...payload
    };
  }

  document.addEventListener(
    "DOMContentLoaded",
    function () {

      const loginSection =
        byId("loginSection");

      const registerSection =
        byId("registerSection");

      const recoverSection =
        byId("recoverSection");

      const loginForm =
        byId("loginForm");

      const registerForm =
        byId("registerForm");

      const recoverForm =
        byId("recoverForm");


      if (
        !loginSection ||
        !registerSection ||
        !recoverSection ||
        !loginForm ||
        !registerForm ||
        !recoverForm
      ) {
        return;
      }


      // لو المستخدم مسجل دخول بالفعل
      const existingUser =
        window.ESPANStore?.currentUser?.();

      if (existingUser?.role) {

        const home =
          window.ESPANStore.roleHome?.(
            existingUser.role
          ) ||
          "account.html";

        window.location.replace(home);

        return;
      }


      function showSection(
        name,
        updateHash
      ) {

        const isLogin =
          name === "login";

        const isRegister =
          name === "register";

        const isRecover =
          name === "recover";


        loginSection.classList.toggle(
          "active",
          isLogin
        );

        registerSection.classList.toggle(
          "active",
          isRegister
        );

        recoverSection.classList.toggle(
          "active",
          isRecover
        );


        if (isRegister) {

          document.title =
            "إنشاء حساب | ESPAN";

        } else if (isRecover) {

          document.title =
            "استرجاع كلمة المرور | ESPAN";

        } else {

          document.title =
            "تسجيل الدخول | ESPAN";
        }


        if (updateHash) {

          const hash =
            isRegister
              ? "#registerSection"
              : isRecover
                ? "#recoverSection"
                : "#loginSection";

          history.replaceState(
            null,
            "",
            hash
          );
        }


        const firstInput =
          isRegister
            ? byId("fullName")
            : isRecover
              ? byId("recoverPhone")
              : byId("loginPhone");


        setTimeout(
          function () {
            firstInput?.focus();
          },
          50
        );
      }


      function sectionFromHash() {

        if (
          window.location.hash ===
          "#registerSection"
        ) {
          return "register";
        }

        if (
          window.location.hash ===
          "#recoverSection"
        ) {
          return "recover";
        }

        return "login";
      }


      byId("showRegister")
        ?.addEventListener(
          "click",
          function (event) {

            event.preventDefault();

            showSection(
              "register",
              true
            );
          }
        );


      byId("showLogin")
        ?.addEventListener(
          "click",
          function (event) {

            event.preventDefault();

            showSection(
              "login",
              true
            );
          }
        );


      byId("backToLogin")
        ?.addEventListener(
          "click",
          function (event) {

            event.preventDefault();

            showSection(
              "login",
              true
            );
          }
        );


      document
        .querySelector(
          ".forgot-password"
        )
        ?.addEventListener(
          "click",
          function (event) {

            event.preventDefault();


            const loginPhone =
              normalizePhone(
                byId("loginPhone")
                  ?.value || ""
              );


            if (loginPhone) {
              byId(
                "recoverPhone"
              ).value =
                loginPhone;
            }


            setMessage(
              byId("recoverMessage"),
              ""
            );


            showSection(
              "recover",
              true
            );
          }
        );


      window.addEventListener(
        "hashchange",
        function () {

          showSection(
            sectionFromHash(),
            false
          );
        }
      );


      showSection(
        sectionFromHash(),
        false
      );


      // إظهار وإخفاء كلمات المرور
      document
        .querySelectorAll(
          ".password-toggle"
        )
        .forEach(
          function (button) {

            button.addEventListener(
              "click",
              function () {

                const input =
                  byId(
                    button.dataset
                      .passwordTarget
                  );

                if (!input) {
                  return;
                }


                const reveal =
                  input.type ===
                  "password";


                input.type =
                  reveal
                    ? "text"
                    : "password";


                button.textContent =
                  reveal
                    ? "إخفاء"
                    : "إظهار";


                button.setAttribute(
                  "aria-label",
                  reveal
                    ? "إخفاء كلمة المرور"
                    : "إظهار كلمة المرور"
                );
              }
            );
          }
        );


      // السماح بأرقام الهاتف فقط
      [
        "loginPhone",
        "registerPhone",
        "recoverPhone"
      ].forEach(
        function (id) {

          byId(id)
            ?.addEventListener(
              "input",
              function (event) {

                event.target.value =
                  event.target.value
                    .replace(
                      /[^0-9+\s()-]/g,
                      ""
                    );
              }
            );
        }
      );


      // تنسيق Recovery Code
      byId("recoveryCode")
        ?.addEventListener(
          "input",
          function (event) {

            event.target.value =
              event.target.value
                .toUpperCase()
                .replace(
                  /[^A-Z0-9-]/g,
                  ""
                );
          }
        );


      // إزالة رسائل الأخطاء
      [
        [
          "loginPhone",
          "loginPhoneError",
          "loginMessage"
        ],

        [
          "loginPassword",
          "loginPasswordError",
          "loginMessage"
        ],

        [
          "fullName",
          "fullNameError",
          "registerMessage"
        ],

        [
          "registerPhone",
          "registerPhoneError",
          "registerMessage"
        ],

        [
          "city",
          "cityError",
          "registerMessage"
        ],

        [
          "address",
          "addressError",
          "registerMessage"
        ],

        [
          "registerPassword",
          "registerPasswordError",
          "registerMessage"
        ],

        [
          "confirmPassword",
          "confirmPasswordError",
          "registerMessage"
        ],

        [
          "recoverPhone",
          "recoverPhoneError",
          "recoverMessage"
        ],

        [
          "recoveryCode",
          "recoveryCodeError",
          "recoverMessage"
        ],

        [
          "recoverPassword",
          "recoverPasswordError",
          "recoverMessage"
        ],

        [
          "recoverConfirmPassword",
          "recoverConfirmPasswordError",
          "recoverMessage"
        ]
      ].forEach(
        function (
          [
            inputId,
            errorId,
            messageId
          ]
        ) {

          const input =
            byId(inputId);


          input?.addEventListener(
            "input",
            function () {

              clearField(
                input,
                byId(errorId)
              );

              setMessage(
                byId(messageId),
                ""
              );
            }
          );


          input?.addEventListener(
            "change",
            function () {

              clearField(
                input,
                byId(errorId)
              );
            }
          );
        }
      );


      // =========================
      // تسجيل الدخول
      // =========================

      loginForm.addEventListener(
        "submit",
        function (event) {

          event.preventDefault();


          const phoneInput =
            byId("loginPhone");

          const passwordInput =
            byId("loginPassword");

          const phoneError =
            byId(
              "loginPhoneError"
            );

          const passwordError =
            byId(
              "loginPasswordError"
            );

          const message =
            byId(
              "loginMessage"
            );

          const button =
            loginForm.querySelector(
              ".auth-submit"
            );

          const buttonText =
            button?.querySelector(
              "span"
            );


          clearField(
            phoneInput,
            phoneError
          );

          clearField(
            passwordInput,
            passwordError
          );

          setMessage(
            message,
            ""
          );


          const phone =
            normalizePhone(
              phoneInput?.value
            );

          const password =
            passwordInput?.value ||
            "";


          let valid = true;


          if (
            !isValidLibyanPhone(
              phone
            )
          ) {

            fieldError(
              phoneInput,
              phoneError,
              "يرجى إدخال رقم هاتف ليبي صحيح."
            );

            valid = false;
          }


          if (!password) {

            fieldError(
              passwordInput,
              passwordError,
              "يرجى إدخال كلمة المرور."
            );

            valid = false;
          }


          if (!valid) {
            return;
          }


          if (
            !window.ESPANStore ||
            typeof window.ESPANStore
              .login !==
              "function"
          ) {

            setMessage(
              message,
              "تعذر تشغيل نظام الدخول. افتحي المشروع من خلال الخادم المحلي ثم أعيدي المحاولة.",
              "error"
            );

            return;
          }


          if (button) {
            button.disabled =
              true;
          }

          if (buttonText) {
            buttonText.textContent =
              "جارٍ تسجيل الدخول...";
          }


          try {

            const result =
              window.ESPANStore.login(
                phone,
                password
              );


            if (!result?.ok) {

              setMessage(
                message,
                result?.message ||
                  "رقم الهاتف أو كلمة المرور غير صحيحة.",
                "error"
              );


              if (button) {
                button.disabled =
                  false;
              }

              if (buttonText) {
                buttonText.textContent =
                  "تسجيل الدخول";
              }

              return;
            }


            window.ESPANStore
              .persistNow?.();


            const role =
              result.user?.role ||
              window.ESPANStore
                .currentUser?.()
                ?.role ||
              "customer";


            const roleTarget =
              window.ESPANStore
                .roleHome?.(
                  role
                ) ||
              "account.html";


            const target =
              window.ESPANStore
                .redirectUrl?.(
                  result.redirect ||
                    roleTarget
                ) ||
              (
                result.redirect ||
                roleTarget
              );


            setMessage(
              message,
              "تم تسجيل الدخول بنجاح، جارٍ فتح حسابك...",
              "success"
            );


            setTimeout(
              function () {

                window.location.href =
                  target;
              },
              120
            );

          } catch (error) {

            console.error(
              "Login error:",
              error
            );


            setMessage(
              message,
              "حدث خطأ أثناء تسجيل الدخول. أعيدي المحاولة.",
              "error"
            );


            if (button) {
              button.disabled =
                false;
            }

            if (buttonText) {
              buttonText.textContent =
                "تسجيل الدخول";
            }
          }
        }
      );


      // =========================
      // إنشاء حساب
      // =========================

      registerForm.addEventListener(
        "submit",
        function (event) {

          event.preventDefault();


          const fullNameInput =
            byId("fullName");

          const phoneInput =
            byId(
              "registerPhone"
            );

          const cityInput =
            byId("city");

          const addressInput =
            byId("address");

          const passwordInput =
            byId(
              "registerPassword"
            );

          const confirmInput =
            byId(
              "confirmPassword"
            );

          const termsInput =
            byId(
              "acceptTerms"
            );

          const message =
            byId(
              "registerMessage"
            );

          const button =
            registerForm
              .querySelector(
                ".auth-submit"
              );

          const buttonText =
            button?.querySelector(
              "span"
            );


          registerForm
            .querySelectorAll(
              "input, select"
            )
            .forEach(
              function (input) {

                input.classList
                  .remove(
                    "invalid"
                  );
              }
            );


          registerForm
            .querySelectorAll(
              ".field-error"
            )
            .forEach(
              function (error) {

                error.textContent =
                  "";
              }
            );


          setMessage(
            message,
            ""
          );


          const data = {

            full_name:
              fullNameInput
                ?.value
                .trim() ||
              "",

            phone:
              normalizePhone(
                phoneInput
                  ?.value
              ),

            city:
              cityInput?.value ||
              "",

            address:
              addressInput
                ?.value
                .trim() ||
              "",

            password:
              passwordInput
                ?.value ||
              ""
          };


          const confirmation =
            confirmInput?.value ||
            "";


          let valid = true;


          if (
            data.full_name
              .length <
            3
          ) {

            fieldError(
              fullNameInput,
              byId(
                "fullNameError"
              ),
              "يرجى كتابة الاسم الكامل."
            );

            valid = false;
          }


          if (
            !isValidLibyanPhone(
              data.phone
            )
          ) {

            fieldError(
              phoneInput,
              byId(
                "registerPhoneError"
              ),
              "يرجى إدخال رقم هاتف ليبي صحيح."
            );

            valid = false;
          }


          if (!data.city) {

            fieldError(
              cityInput,
              byId(
                "cityError"
              ),
              "يرجى اختيار المدينة."
            );

            valid = false;
          }


          if (
            data.address.length <
            4
          ) {

            fieldError(
              addressInput,
              byId(
                "addressError"
              ),
              "يرجى كتابة عنوان واضح."
            );

            valid = false;
          }


          if (
            data.password.length <
            8
          ) {

            fieldError(
              passwordInput,
              byId(
                "registerPasswordError"
              ),
              "كلمة المرور يجب أن تكون 8 أحرف على الأقل."
            );

            valid = false;
          }


          if (
            data.password !==
            confirmation
          ) {

            fieldError(
              confirmInput,
              byId(
                "confirmPasswordError"
              ),
              "كلمتا المرور غير متطابقتين."
            );

            valid = false;
          }


          if (
            !termsInput?.checked
          ) {

            setMessage(
              message,
              "يجب الموافقة على الشروط والأحكام.",
              "error"
            );

            valid = false;
          }


          if (!valid) {
            return;
          }


          if (
            !window.ESPANStore ||
            typeof window.ESPANStore
              .registerCustomer !==
              "function"
          ) {

            setMessage(
              message,
              "تعذر تشغيل نظام إنشاء الحساب. افتحي المشروع من خلال الخادم المحلي ثم أعيدي المحاولة.",
              "error"
            );

            return;
          }


          if (button) {
            button.disabled =
              true;
          }

          if (buttonText) {
            buttonText.textContent =
              "جارٍ إنشاء الحساب...";
          }


          try {

            const result =
              window.ESPANStore
                .registerCustomer(
                  data
                );


            if (!result?.ok) {

              setMessage(
                message,
                result?.message ||
                  "تعذر إنشاء الحساب.",
                "error"
              );


              if (button) {
                button.disabled =
                  false;
              }

              if (buttonText) {
                buttonText.textContent =
                  "إنشاء الحساب";
              }

              return;
            }


            window.ESPANStore
              .persistNow?.();


            const target =
              window.ESPANStore
                .redirectUrl?.(
                  result.redirect ||
                    "account.html"
                ) ||
              (
                result.redirect ||
                "account.html"
              );


            const recoveryCode =
              result.recoveryCode ||
              "";


            if (recoveryCode) {

              alert(
                "تم إنشاء الحساب بنجاح ✅\n\n" +
                "رمز استرجاع حسابك:\n\n" +
                recoveryCode +
                "\n\nاحتفظي بهذا الرمز في مكان آمن، ستحتاجينه إذا نسيتِ كلمة المرور."
              );
            }


            setMessage(
              message,
              "تم إنشاء الحساب بنجاح، جارٍ فتح حسابك...",
              "success"
            );


            setTimeout(
              function () {

                window.location.href =
                  target;
              },
              120
            );

          } catch (error) {

            console.error(
              "Registration error:",
              error
            );


            setMessage(
              message,
              "حدث خطأ أثناء إنشاء الحساب. أعيدي المحاولة.",
              "error"
            );


            if (button) {
              button.disabled =
                false;
            }

            if (buttonText) {
              buttonText.textContent =
                "إنشاء الحساب";
            }
          }
        }
      );


      // =========================
      // استرجاع كلمة المرور
      // =========================

      recoverForm.addEventListener(
        "submit",
        async function (event) {

          event.preventDefault();


          const phoneInput =
            byId(
              "recoverPhone"
            );

          const codeInput =
            byId(
              "recoveryCode"
            );

          const passwordInput =
            byId(
              "recoverPassword"
            );

          const confirmInput =
            byId(
              "recoverConfirmPassword"
            );


          const phoneError =
            byId(
              "recoverPhoneError"
            );

          const codeError =
            byId(
              "recoveryCodeError"
            );

          const passwordError =
            byId(
              "recoverPasswordError"
            );

          const confirmError =
            byId(
              "recoverConfirmPasswordError"
            );


          const message =
            byId(
              "recoverMessage"
            );

          const button =
            recoverForm
              .querySelector(
                ".auth-submit"
              );

          const buttonText =
            button?.querySelector(
              "span"
            );


          [
            phoneInput,
            codeInput,
            passwordInput,
            confirmInput
          ].forEach(
            function (input) {

              input?.classList
                .remove(
                  "invalid"
                );
            }
          );


          [
            phoneError,
            codeError,
            passwordError,
            confirmError
          ].forEach(
            function (error) {

              if (error) {
                error.textContent =
                  "";
              }
            }
          );


          setMessage(
            message,
            ""
          );


          const phone =
            normalizePhone(
              phoneInput?.value
            );


          const recoveryCode =
            String(
              codeInput?.value ||
              ""
            )
              .trim()
              .toUpperCase();


          const newPassword =
            passwordInput?.value ||
            "";


          const confirmation =
            confirmInput?.value ||
            "";


          let valid = true;


          if (
            !isValidLibyanPhone(
              phone
            )
          ) {

            fieldError(
              phoneInput,
              phoneError,
              "يرجى إدخال رقم هاتف ليبي صحيح."
            );

            valid = false;
          }


          if (
            !/^ESP-[A-Z0-9]{4}-[A-Z0-9]{4}$/
              .test(
                recoveryCode
              )
          ) {

            fieldError(
              codeInput,
              codeError,
              "رمز الاسترجاع يجب أن يكون مثل ESP-XXXX-XXXX."
            );

            valid = false;
          }


          if (
            newPassword.length <
            8
          ) {

            fieldError(
              passwordInput,
              passwordError,
              "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل."
            );

            valid = false;
          }


          if (
            newPassword !==
            confirmation
          ) {

            fieldError(
              confirmInput,
              confirmError,
              "كلمتا المرور غير متطابقتين."
            );

            valid = false;
          }


          if (!valid) {
            return;
          }


          if (button) {
            button.disabled =
              true;
          }

          if (buttonText) {
            buttonText.textContent =
              "جارٍ تغيير كلمة المرور...";
          }


          try {

            const result =
              await recoverPassword({
                phone,
                recoveryCode,
                newPassword
              });


            if (!result?.ok) {

              setMessage(
                message,
                result?.message ||
                  "تعذر استرجاع الحساب.",
                "error"
              );


              if (button) {
                button.disabled =
                  false;
              }

              if (buttonText) {
                buttonText.textContent =
                  "تغيير كلمة المرور";
              }

              return;
            }


            const newRecoveryCode =
              result.recoveryCode ||
              "";


            if (
              newRecoveryCode
            ) {

              alert(
                "تم تغيير كلمة المرور بنجاح ✅\n\n" +
                "رمز الاسترجاع القديم تم إلغاؤه.\n\n" +
                "رمز الاسترجاع الجديد:\n\n" +
                newRecoveryCode +
                "\n\nاحتفظي بالرمز الجديد في مكان آمن."
              );
            }


            setMessage(
              message,
              "تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.",
              "success"
            );


            byId(
              "loginPhone"
            ).value =
              phone;


            byId(
              "loginPassword"
            ).value =
              "";


            recoverForm.reset();


            setTimeout(
              function () {

                showSection(
                  "login",
                  true
                );

                byId(
                  "loginPassword"
                )?.focus();
              },
              300
            );

          } catch (error) {

            console.error(
              "Recovery error:",
              error
            );


            setMessage(
              message,
              "حدث خطأ أثناء استرجاع الحساب. أعيدي المحاولة.",
              "error"
            );


            if (button) {
              button.disabled =
                false;
            }

            if (buttonText) {
              buttonText.textContent =
                "تغيير كلمة المرور";
            }
          }
        }
      );
    }
  );
}());