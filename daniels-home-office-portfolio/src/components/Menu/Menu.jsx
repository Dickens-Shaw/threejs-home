import "./Menu.scss";
import { NavLink } from "react-router";
import { useToggleRoomStore } from "../../stores/toggleRoomStore";
import { useEffect, useRef } from "react";
import gsap from "gsap";

const Menu = () => {
  const { isDarkRoom, isBeforeZooming } = useToggleRoomStore();

  const menuRef = useRef();

  const buttonClassNames = `nav-button${!isDarkRoom ? " light" : ""}`;

  useEffect(() => {
    if (!menuRef.current) return;

    if (isBeforeZooming) {
      gsap.to(menuRef.current, {
        opacity: 0,
        duration: 1,
      });
    } else {
      gsap.to(menuRef.current, {
        opacity: 1,
        duration: 1,
      });
    }
  }, [isBeforeZooming]);

  return (
    <>
      <nav ref={menuRef} className="menu">
        <div className="first-row">
          <NavLink to="/">
            <svg
              width="15"
              height="13"
              viewBox="0 0 15 13"
              fill="none"
              className={`home-button ${buttonClassNames}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.28261 5.07317L0 7.29268H1.63043V13H6.19565V9.19512H8.80435V13H13.3696V7.29268H15L7.5 0L4.8913 2.53659V0.951219H2.28261V5.07317ZM2.93478 1.58537H4.23913V4.06741L7.5 0.896683L13.4257 6.65854H12.7174V12.3659H9.45652V8.56098H5.54348V12.3659H2.28261V6.65854H1.57435L2.93478 5.33571V1.58537Z"
                fill="currentColor"
              />
            </svg>
          </NavLink>
          <NavLink to="/about">
            <svg
              width="10"
              height="13"
              viewBox="0 0 10 13"
              fill="none"
              className={`about-button ${buttonClassNames}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="0.35"
                y="7.85479"
                width="9.3"
                height="5"
                stroke="currentColor"
                strokeWidth="0.6"
              />
              <rect
                x="2.35"
                y="0.35"
                width="5.49048"
                height="5.49048"
                stroke="currentColor"
                strokeWidth="0.6"
              />
            </svg>
          </NavLink>
        </div>
        <div className="second-row">
          <NavLink to="/dev-work">
            <svg
              width="18"
              height="15"
              viewBox="0 0 18 15"
              fill="none"
              className={`dev-button ${buttonClassNames}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 7.56885L6.09669 4.00011"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <path
                d="M1.34851 7.58472L6.4452 11.1535"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <path
                d="M17.45 7.56885L12.3488 4.00011"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <path
                d="M17.1011 7.58472L11.9999 11.1535"
                stroke="currentColor"
                strokeWidth="0.7"
              />
              <path d="M9 14L11 1" stroke="currentColor" strokeWidth="0.7" />
            </svg>
          </NavLink>
          <NavLink to="/design-work">
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              className={`design-button ${buttonClassNames}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.48928 1.80178L8.9375 0.353553L12.6464 4.0625L11.1982 5.51072L11.125 5.58395V5.6875V9.57489L2.50169 12.7106L2.14683 12.3558L5.34618 9.15646C5.45696 9.17684 5.57106 9.1875 5.6875 9.1875C6.72303 9.1875 7.5625 8.34806 7.5625 7.3125C7.5625 6.27697 6.72303 5.4375 5.6875 5.4375C4.65197 5.4375 3.8125 6.27697 3.8125 7.3125C3.8125 7.42891 3.82314 7.54302 3.84354 7.65385L0.644226 10.8532L0.289359 10.4983L3.42511 1.875H7.3125H7.41605L7.48928 1.80178Z"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </svg>
          </NavLink>
        </div>
      </nav>
    </>
  );
};

export default Menu;
